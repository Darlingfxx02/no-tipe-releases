//! One-message instructions appended after dictation editing, with a saved library.
use crate::{domain::Preferences, store::Store};
use serde::{Deserialize, Serialize};

pub fn default_color() -> String { "#F5C84C".into() }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Definition {
    pub id: String,
    pub name: String,
    pub instruction: String,
    pub color: String,
    #[serde(default)]
    pub builtin: bool,
}
impl Definition {
    pub fn validate(&self) -> Result<(), String> {
        if self.id != "brief" && uuid::Uuid::parse_str(&self.id).is_err() { return Err(crate::localization::message("Empowerments.invalid_id")); }
        if self.id != "brief" && (self.name.trim().is_empty() || self.name.chars().count() > 100 || self.instruction.trim().is_empty() || self.instruction.chars().count() > 20000) { return Err(crate::localization::message("Empowerments.invalid_fields")); }
        if self.color.len() != 7 || !self.color.starts_with('#') || !self.color[1..].bytes().all(|c| c.is_ascii_hexdigit()) { return Err(crate::localization::message("Empowerments.invalid_color")); }
        Ok(())
    }
    pub fn normalized(mut self) -> Result<Self, String> {
        self.validate()?;
        self.builtin = self.id == "brief";
        self.name = if self.builtin { String::new() } else { self.name.trim().into() };
        self.instruction = if self.builtin { String::new() } else { self.instruction.trim().into() };
        self.color = self.color.to_uppercase();
        Ok(self)
    }
}
fn instruction_language(preferences: &Preferences) -> &str {
    match preferences.translation.as_str() { "english" => "en", "russian" => "ru", _ => &preferences.ui_language }
}
pub fn catalog(store: &Store, preferences: &Preferences) -> Result<Vec<Definition>, String> {
    let saved = store.list::<Definition>("empowerments")?;
    let mut items = vec![Definition {
        id: "brief".into(), name: crate::localization::text(&preferences.ui_language, "Empowerments.brief").into(),
        instruction: crate::localization::text(instruction_language(preferences), "Empowerments.brief_instruction").into(),
        color: saved.iter().find(|item| item.id == "brief").map(|item| item.color.clone()).unwrap_or_else(default_color), builtin: true,
    }];
    items.extend(saved.into_iter().filter(|item| item.id != "brief"));
    Ok(items)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Empowerment {
    pub id: String,
    pub instruction: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub localized: bool,
}
impl Empowerment {
    pub fn resolve(id: Option<&str>, preferences: &Preferences) -> Result<Option<Self>, String> {
        match id {
            None | Some("") => Ok(None),
            Some("brief") => Ok(Some(Self { id: "brief".into(), instruction: crate::localization::text(instruction_language(preferences), "Empowerments.brief_instruction").into(), name: crate::localization::text(&preferences.ui_language, "Empowerments.brief").into(), color: default_color(), localized: true })),
            _ => Err(crate::localization::message("Empowerments.unknown")),
        }
    }
    pub fn resolve_saved(id: Option<&str>, store: &Store, preferences: &Preferences) -> Result<Option<Self>, String> {
        let Some(id) = id.filter(|id| !id.is_empty()) else { return Ok(None); };
        let item = catalog(store, preferences)?.into_iter().find(|item| item.id == id).ok_or_else(|| crate::localization::message("Empowerments.unknown"))?;
        Ok(Some(Self { id: item.id, name: item.name, instruction: item.instruction, color: item.color, localized: item.builtin }))
    }
    pub fn append(&self, text: &str) -> String {
        if text.trim().is_empty() { return text.into(); }
        format!("{}\n\n{}", text.trim_end(), self.instruction.trim())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn briefing_appends_without_starting_model_processing() {
        let preferences = Preferences { ui_language: "ru".into(), ..Default::default() };
        let modifier = Empowerment::resolve(Some("brief"), &preferences).unwrap().unwrap();
        assert!(crate::domain::processing_prompt(&preferences, None).is_none());
        assert!(modifier.append("Хочу приложение.\n").contains("Одним сообщением"));
        assert!(modifier.append("").is_empty());
        assert!(Empowerment::resolve(None, &preferences).unwrap().is_none());
        assert!(Empowerment::resolve(Some("brief"), &Preferences { translation: "english".into(), ..preferences }).unwrap().unwrap().instruction.starts_with("Analyze my request"));
    }
    #[test]
    fn custom_library_survives_restart_and_backup_and_sessions_keep_the_original_instruction() {
        let root = std::env::temp_dir().join(format!("no-type-empowerments-{}", uuid::Uuid::new_v4()));
        let item = Definition { id: uuid::Uuid::new_v4().to_string(), name: " Review ".into(), instruction: " Ask about risks. ".into(), color: "#aabbcc".into(), builtin: true }.normalized().unwrap();
        let store = Store::open(&root).unwrap();
        store.put("empowerments", &item.id, &item).unwrap();
        let frozen = Empowerment::resolve_saved(Some(&item.id), &store, &Preferences::default()).unwrap().unwrap();
        let mut changed = item.clone(); changed.instruction = "New instruction".into();
        store.put("empowerments", &item.id, &changed).unwrap();
        assert_eq!(frozen.append("Text"), "Text\n\nAsk about risks.");
        assert_eq!(frozen.color, "#AABBCC"); assert!(!frozen.localized);
        let backup = store.backup().unwrap();
        assert_eq!(backup.empowerments.len(), 1);
        drop(store);
        let store = Store::open(&root).unwrap();
        assert_eq!(catalog(&store, &Preferences::default()).unwrap().len(), 2);
        store.delete("empowerments", &item.id).unwrap();
        store.import_backup(backup).unwrap();
        assert_eq!(Empowerment::resolve_saved(Some(&item.id), &store, &Preferences::default()).unwrap().unwrap().instruction, "New instruction");
        drop(store); std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_empty_fields_and_unsafe_colors() {
        let mut item = Definition { id: uuid::Uuid::new_v4().to_string(), name: "Test".into(), instruction: "Instructions".into(), color: "#F5C84C".into(), builtin: false };
        assert!(item.validate().is_ok()); item.color = "red;display:none".into(); assert!(item.validate().is_err());
        item.color = "#F5C84C".into(); item.instruction.clear(); assert!(item.validate().is_err());
    }
}
