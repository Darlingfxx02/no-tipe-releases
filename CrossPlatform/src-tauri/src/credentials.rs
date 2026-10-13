use crate::store::err;
const SERVICE: &str = crate::channel::IDENTIFIER;
fn entry(provider: &str) -> Result<keyring::Entry, String> {
    if provider.is_empty() || provider.len() > 150 || provider.contains('\0') {
        return Err("Invalid credential name".into());
    }
    keyring::Entry::new(SERVICE, provider).map_err(err)
}
fn removed_entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(&format!("{SERVICE}.removed-credentials"), provider).map_err(err)
}
fn was_removed(provider: &str) -> bool {
    removed_entry(provider).and_then(|e| e.get_attributes().map_err(err)).is_ok()
}
fn legacy_entries(provider: &str) -> Vec<keyring::Entry> {
    // Repository credentials belong to the disconnected update configuration.
    if crate::channel::DEVELOPER || provider == "github-updates" {
        return vec![];
    }
    let mut entries = vec![];
    if let Ok(e) = keyring::Entry::new(crate::legacy::DESKTOP_IDENTIFIER, provider) {
        entries.push(e);
    }
    #[cfg(target_os = "macos")]
    for service in ["app.no-tipe.native", crate::legacy::NATIVE_IDENTIFIER] {
        if let Ok(e) = keyring::Entry::new(service, &legacy_account(provider)) {
            entries.push(e);
        }
    }
    entries
}
pub fn save(provider: &str, key: &str) -> Result<(), String> {
    crate::diagnostics::remember_secret(key);
    let current = entry(provider)?;
    if key.trim().is_empty() {
        // Keep old installations intact, but never resurrect a removed key.
        removed_entry(provider)?.set_password("removed").map_err(err)?;
        match current.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(err(e)),
        }
    } else {
        current.set_password(key.trim()).map_err(err)
    }
}
pub fn get(provider: &str) -> Result<String, String> {
    let current = entry(provider)?;
    match current.get_password() {
        Ok(key) => { crate::diagnostics::remember_secret(&key); Ok(key) },
        Err(keyring::Error::NoEntry) => {
            if !was_removed(provider) {
                for legacy in legacy_entries(provider) {
                    match legacy.get_password() {
                        Ok(key) => {
                            // A successful read moves future use to the new namespace.
                            current.set_password(&key).map_err(err)?;
                            crate::diagnostics::remember_secret(&key);
                            return Ok(key);
                        }
                        Err(keyring::Error::NoEntry) => {},
                        Err(e) => return Err(err(e)),
                    }
                }
            }
            if provider == "ollama" {
                return Ok(String::new());
            }
            Err(format!("Add the {provider} API key in AI Models"))
        }
        Err(e) => Err(err(e)),
    }
}
pub fn has(provider: &str) -> bool {
    if ["local", "ollama"].contains(&provider) { return true; }
    if entry(provider).and_then(|e| e.get_attributes().map_err(err)).is_ok() { return true; }
    !was_removed(provider) && legacy_entries(provider).iter().any(|e| e.get_attributes().is_ok())
}
pub fn legacy_account(provider: &str) -> String {
    match provider {
        "openai" => "openAIAPIKey".into(),
        "elevenlabs" => "elevenLabsAPIKey".into(),
        "assemblyai" => "assemblyAIAPIKey".into(),
        "openrouter" => "openRouterAPIKey".into(),
        _ => format!("{provider}APIKey"),
    }
}

#[cfg(test)]
mod channel_tests {
    #[test]
    fn developer_credentials_never_read_stable_or_legacy_namespaces() {
        assert_eq!(super::SERVICE, crate::channel::IDENTIFIER);
        if crate::channel::DEVELOPER {
            assert_ne!(super::SERVICE, "app.no-tipe.desktop");
            for provider in ["openai", "ollama", "github-updates"] { assert!(super::legacy_entries(provider).is_empty()); }
        }
    }
}
