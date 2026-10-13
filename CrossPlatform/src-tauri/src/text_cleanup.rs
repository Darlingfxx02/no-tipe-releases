//! Deterministic cleanup of the completed dictation, after all text generation.
use crate::domain::Transcript;

pub fn apply(transcript: &mut Transcript, remove_trailing_period: bool) {
    if !remove_trailing_period { return; }
    let text = transcript.delivered_text();
    let end = text.trim_end().len();
    if !text[..end].ends_with('.') { return; }
    let position = end - 1;
    let mut cleaned = text.to_owned();
    cleaned.remove(position);

    // Rich clipboard content must match plain text, without losing snippet styles.
    transcript.formatted_snippet = transcript.formatted_snippet.as_ref().and_then(|_| {
        let mut snippet = transcript.processing_source.as_ref()?.whole.clone()?;
        if snippet.expansion != text { return None; }
        let offset = text[..position].encode_utf16().count();
        snippet.expansion = cleaned.clone();
        for style in &mut snippet.formatting {
            if style.start > offset { style.start -= 1; }
            if style.end > offset { style.end -= 1; }
        }
        snippet.formatting.retain(|style| style.start < style.end);
        crate::snippets::html(&snippet)
    });
    if cleaned.trim().is_empty() {
        // A punctuation-only result has no text to fall back to for delivery.
        transcript.text = cleaned;
        transcript.enhanced_text = None;
    } else {
        transcript.enhanced_text = Some(cleaned);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{domain::*, session::SessionConfiguration};

    fn transcript(text: &str) -> Transcript {
        serde_json::from_value(serde_json::json!({"id":"cleanup","text":text,"enhancedText":null,"processingError":null,"timestamp":0.,"duration":1.,"audioFile":null,"model":null,"processingModel":null,"mode":null,"status":"completed","transcriptionDuration":null,"enhancementDuration":null})).unwrap()
    }

    #[test]
    fn removes_exactly_one_final_period_and_preserves_everything_else() {
        for (input, expected) in [
            ("Первое. Второе.", "Первое. Второе"),
            ("Версия 1.2.3 готова.", "Версия 1.2.3 готова"),
            ("  Hello.\nNext. \t\n", "  Hello.\nNext \t\n"),
            ("Подожди...", "Подожди.."),
            ("Готово🙂.", "Готово🙂"),
            ("Готово?", "Готово?"), ("Готово!", "Готово!"),
            ("Подожди…", "Подожди…"), ("«Готово.»", "«Готово.»"),
            ("Без точки", "Без точки"), ("", ""), (" \n", " \n"),
            (".", ""), (". \n", " \n"),
        ] {
            let mut t = transcript(input);
            apply(&mut t, false);
            assert_eq!(t.delivered_text(), input);
            apply(&mut t, true);
            assert_eq!(t.delivered_text(), expected, "{input:?}");
        }
    }

    #[test]
    fn cleans_final_processed_output_and_leaves_original_available() {
        let mut t = transcript("Исходный. Текст.");
        t.enhanced_text = Some("First sentence. Translated result.".into());
        apply(&mut t, true);
        assert_eq!(t.text, "Исходный. Текст.");
        assert_eq!(t.delivered_text(), "First sentence. Translated result");
        t.enhanced_text = Some("Question?".into());
        apply(&mut t, true);
        assert_eq!(t.delivered_text(), "Question?");
    }

    #[test]
    fn preserves_formatted_snippet_styles_and_saved_expansion() {
        let snippet = crate::snippets::Snippet {
            id: "sig".into(), trigger: "signature".into(), expansion: "Я🙂. \n".into(),
            enabled: true, date_added: 0.,
            formatting: vec![crate::snippets::TextStyle { start: 0, end: 6, bold: true, italic: false, link: None }],
        };
        let mut t = transcript(&snippet.expansion);
        t.formatted_snippet = crate::snippets::html(&snippet);
        t.processing_source = Some(crate::snippets::prepare("signature", &[snippet.clone()]));
        apply(&mut t, true);
        assert_eq!(t.delivered_text(), "Я🙂 \n");
        let html = t.formatted_snippet.unwrap();
        assert!(html.contains("<strong>🙂</strong>"));
        assert!(!html.contains('.'));
        assert_eq!(t.processing_source.unwrap().whole.unwrap().expansion, snippet.expansion);
    }

    #[test]
    fn preference_is_saved_without_requiring_ai_and_old_configs_stay_disabled() {
        let root = std::env::temp_dir().join(format!("no-type-cleanup-{}", uuid::Uuid::new_v4()));
        let store = crate::store::Store::open(&root).unwrap();
        let original = store.preferences().unwrap();
        assert!(!original.remove_trailing_period);
        let p = original.patched(&serde_json::json!({"removeTrailingPeriod":true})).unwrap();
        assert!(processing_prompt(&p, None).is_none());
        store.set_meta("preferences", &p).unwrap();
        drop(store);
        let store = crate::store::Store::open(&root).unwrap();
        assert!(store.preferences().unwrap().remove_trailing_period);
        let mut session = crate::session::tests::fixture();
        session.configuration.processing.remove_trailing_period = true;
        let saved = serde_json::to_value(&session.configuration).unwrap();
        let restored: SessionConfiguration = serde_json::from_value(saved.clone()).unwrap();
        assert!(restored.processing.preferences().remove_trailing_period);
        let mut legacy = saved;
        legacy["processing"].as_object_mut().unwrap().remove("removeTrailingPeriod");
        let restored: SessionConfiguration = serde_json::from_value(legacy).unwrap();
        assert!(!restored.processing.remove_trailing_period);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
