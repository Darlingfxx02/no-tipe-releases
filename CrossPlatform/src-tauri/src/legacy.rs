//! Compatibility readers for installations made before the No Type identity change.
//! New writes always use the current application's namespace.
use crate::store::err;
use rusqlite::{Connection, OpenFlags, MAIN_DB};
use std::path::{Path, PathBuf};

pub const DESKTOP_IDENTIFIER: &str = "app.voiceink.desktop";
pub const NATIVE_IDENTIFIER: &str = "com.prakashjoshipax.VoiceInk";
pub const DATABASE: &str = "voiceink.sqlite3";
pub const BACKUP_FORMAT: &str = "voiceink-desktop";
pub const CURRENT_DATABASE: &str = "no-tipe.sqlite3";

pub fn native_root(home: &Path) -> PathBuf {
    let support = home.join("Library/Application Support");
    let current = support.join("app.no-tipe.native");
    if current.join("default.store").is_file() {
        current
    } else {
        support.join(NATIVE_IDENTIFIER)
    }
}

/// Snapshot the old SQLite database, including committed WAL rows. Never rename
/// its live database or copy the WAL/SHM files independently.
pub fn snapshot_database(source: &Path, target: &Path) -> Result<(), String> {
    let temporary = target.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let db = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
        db.backup(MAIN_DB, &temporary, None).map_err(err)?;
        std::fs::rename(&temporary, target).map_err(err)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

/// Stage the entire data directory before publishing it. Existing No Type data
/// wins; the old directory is retained as a recovery source.
pub fn prepare_data_root(root: &Path) -> Result<(), String> {
    let parent = root.parent().ok_or("Application data directory has no parent")?;
    let source = parent.join(DESKTOP_IDENTIFIER);
    if !source.join(DATABASE).is_file() || root.join(CURRENT_DATABASE).exists() || root.join(DATABASE).exists() {
        return Ok(());
    }
    if root.exists() && std::fs::read_dir(root).map_err(err)?.next().is_some() {
        return Err("No Type data directory is not empty; refusing to overwrite it during migration".into());
    }
    std::fs::create_dir_all(parent).map_err(err)?;
    let staging = parent.join(format!(".no-tipe-migration-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        copy_data(&source, &staging)?;
        snapshot_database(&source.join(DATABASE), &staging.join(CURRENT_DATABASE))?;
        let db = Connection::open(staging.join(CURRENT_DATABASE)).map_err(err)?;
        let transaction = db.unchecked_transaction().map_err(err)?;
        for (table, field) in [("transcripts", "audioFile"), ("models", "path")] {
            let rows = {
                let mut q = transaction.prepare(&format!("SELECT id,json_extract(data,'$.{field}') FROM {table}")).map_err(err)?;
                let rows = q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))).map_err(err)?;
                rows.collect::<Result<Vec<_>, _>>().map_err(err)?
            };
            for (id, path) in rows {
                if let Some(path) = path.as_deref().map(Path::new) {
                    if let Ok(relative) = path.strip_prefix(&source) {
                        let destination = root.join(relative).to_string_lossy().to_string();
                        // SQLite changes only this field, retaining the original
                        // JSON number representations and user-authored text.
                        transaction.execute(&format!("UPDATE {table} SET data=json_set(data,'$.{field}',?1) WHERE id=?2"), [destination, id]).map_err(err)?;
                    }
                }
            }
        }
        transaction.commit().map_err(err)?;
        drop(db);
        if root.exists() {
            std::fs::remove_dir(root).map_err(err)?;
        }
        std::fs::rename(&staging, root).map_err(err)
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(staging);
    }
    result
}

fn copy_data(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir(target).map_err(err)?;
    for entry in std::fs::read_dir(source).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name();
        let kind = entry.file_type().map_err(err)?;
        if kind.is_symlink() {
            return Err("Symbolic link in legacy data directory; migration left the source intact".into());
        }
        if name == DATABASE || name == format!("{DATABASE}-wal").as_str() || name == format!("{DATABASE}-shm").as_str() {
            continue;
        }
        let destination = target.join(name);
        if kind.is_dir() {
            copy_data(&entry.path(), &destination)?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), destination).map_err(err)?;
        }
    }
    Ok(())
}
