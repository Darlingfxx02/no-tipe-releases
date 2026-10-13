use crate::domain::DictionaryEntry;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    pub trigger: String,
    pub expansion: String,
    pub enabled: bool,
    pub date_added: f64,
    #[serde(default)]
    pub formatting: Vec<TextStyle>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    pub start: usize,
    pub end: usize,
    #[serde(default)] pub bold: bool,
    #[serde(default)] pub italic: bool,
    pub link: Option<String>,
}
pub fn normalized(text: &str) -> String {
    text.chars().flat_map(char::to_lowercase).filter(|c| c.is_alphanumeric()).collect()
}
pub fn validate(snippet: &Snippet) -> Result<(), String> {
    if snippet.id.is_empty() || !snippet.date_added.is_finite() { return Err("Invalid snippet".into()); }
    if normalized(&snippet.trigger).is_empty() { return Err("Enter a spoken phrase containing letters or numbers.".into()); }
    if snippet.trigger.chars().count() > 60 { return Err("The spoken phrase can contain up to 60 characters.".into()); }
    if snippet.expansion.trim().is_empty() { return Err("Enter the text to insert.".into()); }
    if snippet.expansion.chars().count() > 4000 { return Err("The saved text can contain up to 4,000 characters.".into()); }
    let mut boundaries = vec![0];
    let mut offset = 0;
    for c in snippet.expansion.chars() { offset += c.len_utf16(); boundaries.push(offset); }
    let mut end = 0;
    for style in &snippet.formatting {
        if style.start < end || style.start >= style.end || !boundaries.contains(&style.start) || !boundaries.contains(&style.end) {
            return Err("Invalid snippet formatting".into());
        }
        if let Some(link) = &style.link {
            let url = url::Url::parse(link).map_err(|_| "Enter a valid link")?;
            if !["http", "https", "mailto"].contains(&url.scheme()) { return Err("Use an http, https or mailto link.".into()); }
        }
        end = style.end;
    }
    Ok(())
}
pub fn conflict(snippet: &Snippet, snippets: &[Snippet], dictionary: &[DictionaryEntry]) -> bool {
    let key = normalized(&snippet.trigger);
    snippets.iter().any(|s| s.id != snippet.id && normalized(&s.trigger) == key)
        || dictionary.iter().any(|d| d.word.split(',').any(|word| normalized(word) == key))
}
#[derive(Serialize)]
pub struct ImportPreview { pub items: Vec<Snippet>, pub skipped: usize }
pub fn preview_import(bytes: &[u8], snippets: &[Snippet], dictionary: &[DictionaryEntry]) -> Result<ImportPreview, String> {
    if bytes.len() > 3 * 1024 * 1024 { return Err("The JSON file must be smaller than 3 MB.".into()); }
    let values: Vec<serde_json::Value> = serde_json::from_slice(bytes).map_err(|_| "Use a JSON array of objects with name and text fields.")?;
    let mut known = snippets.to_vec(); let mut items = Vec::new(); let mut skipped = 0;
    for value in values {
        let (Some(name), Some(text)) = (value["name"].as_str(), value["text"].as_str()) else { skipped += 1; continue; };
        let snippet = Snippet { id: uuid::Uuid::new_v4().to_string(), trigger: name.trim().into(), expansion: text.into(), enabled: true, date_added: chrono::Utc::now().timestamp_millis() as f64 / 1000., formatting: vec![] };
        if validate(&snippet).is_err() || conflict(&snippet, &known, dictionary) { skipped += 1; continue; }
        known.push(snippet.clone()); items.push(snippet);
    }
    if items.len() > 1000 { return Err("Import up to 1,000 snippets at a time.".into()); }
    Ok(ImportPreview { items, skipped })
}
pub fn html(snippet: &Snippet) -> Option<String> {
    if snippet.formatting.is_empty() || validate(snippet).is_err() { return None; }
    let mut html = String::from("<div>");
    let mut offset = 0;
    for c in snippet.expansion.chars() {
        let style = snippet.formatting.iter().find(|s| s.start <= offset && offset < s.end);
        if let Some(s) = style {
            if s.bold { html.push_str("<strong>"); }
            if s.italic { html.push_str("<em>"); }
            if let Some(link) = &s.link { html.push_str(&format!("<a href=\"{}\">", escape(link))); }
        }
        if c == '\n' { html.push_str("<br>"); } else { html.push_str(&escape(&c.to_string())); }
        if let Some(s) = style {
            if s.link.is_some() { html.push_str("</a>"); }
            if s.italic { html.push_str("</em>"); }
            if s.bold { html.push_str("</strong>"); }
        }
        offset += c.len_utf16();
    }
    html.push_str("</div>");
    Some(html)
}
fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}
pub const PRESERVE: &str = "Tokens beginning with NOTIPESNIPPET are opaque saved-text placeholders. Keep each token exactly once and unchanged, in its position relative to the surrounding text. Do not translate, rewrite, remove, duplicate or explain them. Process only the surrounding dictation.";
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Expansion {
    pub protected: String,
    substitutions: Vec<(String, String)>,
    pub whole: Option<Snippet>,
}
impl Expansion {
    pub fn has_matches(&self) -> bool { !self.substitutions.is_empty() }
    pub fn map_surrounding(&self, transform: impl Fn(&str) -> String) -> String {
        let mut result = String::new(); let mut rest = self.protected.as_str();
        while let Some((position, token)) = self.substitutions.iter()
            .filter_map(|(token, _)| rest.find(token).map(|position| (position, token)))
            .min_by_key(|(position, _)| *position) {
            result.push_str(&transform(&rest[..position])); result.push_str(token);
            rest = &rest[position + token.len()..];
        }
        result.push_str(&transform(rest)); result
    }
    pub fn restore(&self, text: &str) -> String {
        let source = if self.substitutions.iter().all(|(token, _)| text.matches(token).count() == 1) { text } else { &self.protected };
        // Replace in one pass so the stored text is never interpreted recursively.
        let mut result = String::new();
        let mut rest = source;
        while let Some((position, token, expansion)) = self.substitutions.iter()
            .filter_map(|(token, expansion)| rest.find(token).map(|position| (position, token, expansion)))
            .min_by_key(|(position, _, _)| *position) {
            result.push_str(&rest[..position]); result.push_str(expansion);
            rest = &rest[position + token.len()..];
        }
        result.push_str(rest); result
    }
}
// Reuse the saved opaque source on repeat processing. Looking up triggers in
// expanded text would reinterpret user snippets and apply replacements twice.
pub fn processing_plan(transcript: &crate::domain::Transcript) -> Expansion {
    transcript.processing_source.clone().unwrap_or_else(|| Expansion {
        protected: transcript.text.clone(), substitutions: vec![], whole: None,
    })
}
pub fn prepare(text: &str, snippets: &[Snippet]) -> Expansion {
    let mut active: Vec<_> = snippets.iter().filter(|s| s.enabled && !normalized(&s.trigger).is_empty()).collect();
    active.sort_by(|a, b| b.trigger.chars().count().cmp(&a.trigger.chars().count()).then_with(|| a.id.cmp(&b.id)));
    let namespace = uuid::Uuid::new_v4().simple().to_string();
    let token = |index: usize| format!("NOTIPESNIPPET{namespace}X{index}");
    let key = normalized(text);
    if let Some(whole) = active.iter().find(|s| !key.is_empty() && normalized(&s.trigger) == key) {
        return Expansion { protected: token(0), substitutions: vec![(token(0), whole.expansion.clone())], whole: Some((*whole).clone()) };
    }
    let chars: Vec<_> = text.char_indices().collect();
    let mut matches: Vec<(usize, usize, &Snippet)> = Vec::new();
    for snippet in active {
        let length = snippet.trigger.chars().count();
        for i in 0..chars.len() {
            if i + length > chars.len() { break; }
            let start = chars[i].0;
            let end = chars.get(i + length).map(|c| c.0).unwrap_or(text.len());
            if text[start..end].to_lowercase() != snippet.trigger.to_lowercase() { continue; }
            let word = |c: char| c.is_alphanumeric() || c == '_';
            if i > 0 && word(chars[i - 1].1) { continue; }
            if chars.get(i + length).is_some_and(|c| word(c.1)) { continue; }
            if text[end..].starts_with("'t") || text[end..].starts_with("’t") { continue; }
            if matches.iter().any(|(s, e, _)| start < *e && end > *s) { continue; }
            matches.push((start, end, snippet));
        }
    }
    matches.sort_by_key(|m| m.0);
    let mut protected = String::new(); let mut cursor = 0;
    let mut substitutions = Vec::new();
    for (index, (start, end, snippet)) in matches.into_iter().enumerate() {
        protected.push_str(&text[cursor..start]); protected.push_str(&token(index)); cursor = end;
        substitutions.push((token(index), snippet.expansion.clone()));
    }
    protected.push_str(&text[cursor..]);
    Expansion { protected, substitutions, whole: None }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snippet(trigger: &str, expansion: &str) -> Snippet {
        Snippet { id: uuid::Uuid::new_v4().to_string(), trigger: trigger.into(), expansion: expansion.into(), enabled: true, date_added: 1., formatting: vec![] }
    }
    #[test]
    fn whole_phrase_keeps_literal_text_and_ignores_case_punctuation_spacing() {
        let saved = "  Alex\nDesigner\nhttps://example.com/$1 \\ ";
        let plan = prepare("MY — Email, Signature!", &[snippet("my email signature", saved)]);
        assert!(plan.whole.is_some()); assert_eq!(plan.restore(&plan.protected), saved);
    }
    #[test]
    fn russian_triggers_and_unicode_boundaries() {
        let entries = [snippet("мой адрес", "Москва")];
        let text = "Отправьте на МОЙ АДРЕС, пожалуйста.";
        let plan = prepare(text, &entries); assert_eq!(plan.restore(&plan.protected), "Отправьте на Москва, пожалуйста.");
        let text = "самыймой адресный текст и мой адрес_дом";
        let plan = prepare(text, &entries); assert_eq!(plan.restore(&plan.protected), text);
    }
    #[test]
    fn longest_overlap_repeated_phrases_and_no_recursive_expansion() {
        let entries = [snippet("email", "SHORT"), snippet("my email", "email"), snippet("my email signature", "LONG")];
        let plan = prepare("Use my email signature, then my email and email.", &entries);
        assert_eq!(plan.restore(&plan.protected), "Use LONG, then email and SHORT.");
        let plan = prepare("Use my link, then my link!", &[snippet("my link", "https://example.com/$1?x=\\path")]);
        assert_eq!(plan.restore(&plan.protected), "Use https://example.com/$1?x=\\path, then https://example.com/$1?x=\\path!");
    }
    #[test]
    fn damaged_ai_output_never_leaks_tokens_or_loses_saved_text() {
        let plan = prepare("Send my signature please.", &[snippet("my signature", "Alex\nDesigner")]);
        assert_eq!(plan.restore("Send please."), "Send Alex\nDesigner please.");
        assert_eq!(plan.restore(&format!("{}{}", plan.protected, plan.substitutions[0].0)), plan.restore(&plan.protected));
        assert_eq!(plan.restore(&plan.protected.to_lowercase()), plan.restore(&plan.protected));
    }
    #[test]
    fn dictionary_edits_cannot_change_tokens_or_expansions() {
        let plan = prepare("Send my email", &[snippet("my email", "a@example.com")]);
        let text = plan.map_surrounding(|text| text.replace('e', "E"));
        assert_eq!(plan.restore(&text), "SEnd a@example.com");
    }
    #[test]
    fn saved_processing_source_preserves_snippets_and_dictionary_after_restart() {
        let mut plan = prepare("teh my signature", &[snippet("my signature", "teh literal text")]);
        plan.protected = plan.map_surrounding(|text| text.replace("teh", "the"));
        let transcript: crate::domain::Transcript = serde_json::from_value(serde_json::json!({
            "id":"saved", "text":plan.restore(&plan.protected), "enhancedText":"manually edited result",
            "processingSource":plan, "timestamp":1., "duration":1., "status":"completed"
        })).unwrap();
        let reopened: crate::domain::Transcript = serde_json::from_str(&serde_json::to_string(&transcript).unwrap()).unwrap();
        let source = processing_plan(&reopened);
        assert_eq!(source.protected, plan.protected);
        assert_eq!(source.restore(&source.protected), "the teh literal text");
        // Damaged provider output falls back to the already corrected source.
        assert_eq!(source.restore("lost placeholder"), "the teh literal text");
        assert_eq!(processing_plan(&reopened).protected, source.protected);
        let mut legacy = reopened;
        legacy.processing_source = None;
        assert_eq!(processing_plan(&legacy).protected, legacy.text);
        assert!(!processing_plan(&legacy).has_matches());
    }
    #[test]
    fn punctuation_possessives_contractions_emoji_and_disabled_snippets() {
        let entries = [snippet("my-link", "URL"), snippet("can", "CAN"), snippet("Alex", "DESIGNER"), snippet("адрес 🏠", "Москва")];
        let plan = prepare("my link and my-link. I can't use Alex's адрес 🏠.", &entries);
        assert_eq!(plan.restore(&plan.protected), "my link and URL. I can't use DESIGNER's Москва.");
        let mut disabled = snippet("my link", "URL"); disabled.enabled = false;
        assert!(!prepare("my link", &[disabled]).has_matches());
    }
    #[test]
    fn validates_limits_duplicates_and_import_data() {
        assert!(validate(&snippet("!!!", "Text")).is_err());
        assert!(validate(&snippet(&"a".repeat(61), "Text")).is_err());
        assert!(validate(&snippet("my signature", " \n ")).is_err());
        assert!(validate(&snippet("my signature", &"a".repeat(4001))).is_err());
        let existing = [snippet("my email", "existing")];
        let dictionary = [DictionaryEntry {id:"word".into(), word:"dictionary word".into(), replacement:None, enabled:true}];
        let json = br#"[{"name":"MY EMAIL!","text":"duplicate"},{"name":"signature","text":"Alex"},{"name":"SIGNATURE","text":"duplicate"},{"name":5,"text":"invalid"},{"name":"!!!","text":"invalid"},{"name":"dictionary word","text":"conflict"}]"#;
        let preview = preview_import(json, &existing, &dictionary).unwrap();
        assert_eq!(preview.items.len(), 1); assert_eq!(preview.skipped, 5);
        assert!(preview_import(b"{}", &[], &[]).is_err());
    }
    #[test]
    fn formatting_is_safe_and_utf16_ranges_cannot_split_emoji() {
        let mut s = snippet("my signature", "Alex <script>\n🎤");
        s.formatting = vec![TextStyle {start:0,end:4,bold:true,italic:true,link:Some("https://example.com/?x=1&y=2".into())}];
        let html = html(&s).unwrap(); assert!(html.contains("<strong>")); assert!(html.contains("&lt;script&gt;")); assert!(!html.contains("<script>"));
        s.formatting[0].link = Some("javascript:alert(1)".into()); assert!(validate(&s).is_err());
        s.expansion = "🎤".into(); s.formatting[0].link = None; s.formatting[0].end = 1; assert!(validate(&s).is_err());
    }
}
