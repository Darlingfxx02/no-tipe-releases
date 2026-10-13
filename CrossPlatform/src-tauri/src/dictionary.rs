//! Literal whole-word/phrase replacements, resolved on the input before writing output.
use crate::domain::DictionaryEntry;
use regex::{Regex, RegexBuilder};
use std::sync::OnceLock;

fn word_character(c: char) -> bool {
    static WORD: OnceLock<Regex> = OnceLock::new();
    WORD.get_or_init(|| Regex::new(r"^\w$").unwrap())
        .is_match(&c.to_string())
}

fn boundary(text: &str, start: usize, end: usize) -> bool {
    let mut left = text[..start].chars().rev();
    let mut right = text[end..].chars();
    let previous = left.next();
    let next = right.next();
    if previous.is_some_and(word_character) || next.is_some_and(word_character) {
        return false;
    }
    let apostrophe = |c| matches!(c, '\'' | '’');
    if previous.is_some_and(apostrophe)
        && left.next().is_some_and(word_character)
        && text[start..end].chars().next().is_some_and(word_character)
    {
        return false;
    }
    if next.is_some_and(apostrophe)
        && right.next().is_some_and(word_character)
        && text[start..end]
            .chars()
            .next_back()
            .is_some_and(word_character)
    {
        return false;
    }
    true
}

pub fn validate(entry: &DictionaryEntry) -> Result<(), String> {
    if entry.id.is_empty() || !entry.word.chars().any(char::is_alphanumeric) {
        return Err("Enter a word or phrase containing letters or numbers".into());
    }
    if entry.word.chars().count() > 1000
        || entry
            .replacement
            .as_ref()
            .is_some_and(|s| s.len() > 100_000)
    {
        return Err("This dictionary entry is too long".into());
    }
    Ok(())
}

struct Rule<'a> {
    entry: &'a DictionaryEntry,
    pattern: Regex,
    priority: usize,
}
struct Match<'a> {
    start: usize,
    end: usize,
    rule: &'a Rule<'a>,
    exact_case: bool,
}

pub struct Replacements {
    pub text: String,
    pub fixes: u64,
}

// Deliberate spelling (iPhone, No Type, API) stays as saved. A lowercase
// replacement follows UPPERCASE, sentence case or Title Case; arbitrary mixed case does not.
fn replacement_case(replacement: &str, matched: &str) -> String {
    if replacement.chars().any(char::is_uppercase) {
        return replacement.into();
    }
    let letters: Vec<_> = matched
        .chars()
        .filter(|c| c.is_lowercase() || c.is_uppercase())
        .collect();
    if !letters.is_empty() && letters.iter().all(|c| c.is_uppercase()) {
        return replacement.to_uppercase();
    }
    if letters.first().is_some_and(|c| c.is_uppercase())
        && letters.iter().skip(1).all(|c| c.is_lowercase())
    {
        let mut capitalized = false;
        return replacement
            .chars()
            .flat_map(|c| {
                if !capitalized && (c.is_lowercase() || c.is_uppercase()) {
                    capitalized = true;
                    c.to_uppercase().collect::<Vec<_>>()
                } else {
                    vec![c]
                }
            })
            .collect();
    }
    let words: Vec<_> = matched
        .split_whitespace()
        .map(|word| {
            word.chars()
                .filter(|c| c.is_lowercase() || c.is_uppercase())
                .collect::<Vec<_>>()
        })
        .filter(|word| !word.is_empty())
        .collect();
    if words.len() > 1
        && words
            .iter()
            .all(|word| word[0].is_uppercase() && word.iter().skip(1).all(|c| c.is_lowercase()))
    {
        let mut capitalized = false;
        return replacement
            .chars()
            .flat_map(|c| {
                if c.is_whitespace() {
                    capitalized = false;
                }
                if !capitalized && (c.is_lowercase() || c.is_uppercase()) {
                    capitalized = true;
                    c.to_uppercase().collect::<Vec<_>>()
                } else {
                    vec![c]
                }
            })
            .collect();
    }
    replacement.into()
}

pub fn apply(text: &str, entries: &[DictionaryEntry]) -> Replacements {
    let rules: Vec<_> = entries
        .iter()
        .filter(|entry| entry.enabled && entry.replacement.is_some() && validate(entry).is_ok())
        .filter_map(|entry| {
            let phrase = entry.word.split_whitespace().collect::<Vec<_>>();
            let expression = phrase
                .iter()
                .map(|word| regex::escape(word))
                .collect::<Vec<_>>()
                .join(r"\s+");
            let pattern = RegexBuilder::new(&expression)
                .case_insensitive(true)
                .build()
                .ok()?;
            Some(Rule {
                entry,
                pattern,
                priority: phrase.join(" ").chars().count(),
            })
        })
        .collect();
    let mut candidates = Vec::new();
    for rule in &rules {
        let mut offset = 0;
        // Enumerate overlapping occurrences too; a different longer rule may
        // claim the first one while leaving the following occurrence available.
        while let Some(found) = rule.pattern.find_at(text, offset) {
            let start = found.start();
            let end = found.end();
            if boundary(text, start, end) {
                let canonical = text[start..end]
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ");
                candidates.push(Match {
                    start,
                    end,
                    rule,
                    exact_case: canonical
                        == rule
                            .entry
                            .word
                            .split_whitespace()
                            .collect::<Vec<_>>()
                            .join(" "),
                });
            }
            let Some(c) = text[start..].chars().next() else {
                break;
            };
            offset = start + c.len_utf8();
        }
    }
    // Longest phrase wins anywhere in an overlap; exact case, stable id and
    // input position resolve ties independently of database insertion order.
    candidates.sort_by(|a, b| {
        b.rule
            .priority
            .cmp(&a.rule.priority)
            .then_with(|| b.exact_case.cmp(&a.exact_case))
            .then_with(|| a.rule.entry.id.cmp(&b.rule.entry.id))
            .then_with(|| a.start.cmp(&b.start))
    });
    let mut accepted = std::collections::BTreeMap::<usize, Match<'_>>::new();
    for candidate in candidates {
        if !accepted
            .range(..candidate.end)
            .next_back()
            .is_some_and(|(_, other)| other.end > candidate.start)
        {
            accepted.insert(candidate.start, candidate);
        }
    }
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    let mut fixes = 0;
    for found in accepted.into_values() {
        output.push_str(&text[cursor..found.start]);
        let replacement = replacement_case(
            found.rule.entry.replacement.as_deref().unwrap(),
            &text[found.start..found.end],
        );
        if replacement != text[found.start..found.end] {
            fixes += 1;
        }
        output.push_str(&replacement);
        cursor = found.end;
    }
    output.push_str(&text[cursor..]);
    Replacements {
        text: output,
        fixes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snippets::{self, Snippet};
    fn rule(id: &str, from: &str, to: &str) -> DictionaryEntry {
        DictionaryEntry {
            id: id.into(),
            word: from.into(),
            replacement: Some(to.into()),
            enabled: true,
        }
    }
    #[test]
    fn russian_english_punctuation_and_word_boundaries() {
        let rules = [rule("cat", "cat", "dog"), rule("ru", "кот", "пёс")];
        let result = apply(
            "cat, scatter cat_ cat2 _cat кот, скот котёнок кот-кот!",
            &rules,
        );
        assert_eq!(
            result.text,
            "dog, scatter cat_ cat2 _cat пёс, скот котёнок пёс-пёс!"
        );
        assert_eq!(result.fixes, 4);
    }
    #[test]
    fn unicode_marks_and_letters_are_not_boundaries() {
        let rules = [rule("cafe", "cafe", "coffee")];
        assert_eq!(
            apply("cafe\u{301} cafe cafe猫 cafe\u{200c}", &rules).text,
            "cafe\u{301} coffee cafe猫 cafe\u{200c}"
        );
    }
    #[test]
    fn contractions_and_possessives_are_whole_words() {
        let rules = [
            rule("can", "can", "able"),
            rule("cat", "cat", "dog"),
            rule("full", "can't", "cannot"),
        ];
        assert_eq!(
            apply("can can't can’t cat's cat’s 'cat' cat", &rules).text,
            "able cannot can’t cat's cat’s 'dog' dog"
        );
    }
    #[test]
    fn case_keeps_saved_brands_and_adapts_lowercase_spelling() {
        let rules = [
            rule("ru", "ашибка", "ошибка"),
            rule("en", "teh", "the"),
            rule("brand", "айфон", "iPhone"),
        ];
        assert_eq!(
            apply("ашибка АШИБКА Ашибка teh TEH Teh tEh айфон АЙФОН", &rules).text,
            "ошибка ОШИБКА Ошибка the THE The the iPhone iPhone"
        );
    }
    #[test]
    fn lowercase_phrases_follow_sentence_uppercase_and_title_case() {
        let rules = [
            rule("city", "new york", "san francisco"),
            rule("ru", "добрый день", "хороший вечер"),
        ];
        assert_eq!(
            apply(
                "new york; New york; NEW YORK; New York; Добрый День",
                &rules
            )
            .text,
            "san francisco; San francisco; SAN FRANCISCO; San Francisco; Хороший Вечер"
        );
    }
    #[test]
    fn phrases_accept_unicode_whitespace_but_require_literal_punctuation() {
        let rules = [
            rule("phrase", "no type", "No Type"),
            rule("lang", "C++", "Rust"),
        ];
        assert_eq!(
            apply("NO\u{a0}TYPE! no\n type no, type C++ C++foo AC++", &rules).text,
            "No Type! No Type no, type Rust C++foo AC++"
        );
    }
    #[test]
    fn longest_overlapping_rule_wins_independent_of_entry_order() {
        let mut rules = vec![
            rule("one", "new", "old"),
            rule("two", "new york", "Paris"),
            rule("three", "york city guide", "map"),
        ];
        let text = "new york city guide; new york; new";
        assert_eq!(apply(text, &rules).text, "old map; Paris; old");
        rules.reverse();
        assert_eq!(apply(text, &rules).text, "old map; Paris; old");
    }
    #[test]
    fn exact_case_then_id_resolve_identical_rules() {
        let rules = [
            rule("a", "teh", "first"),
            rule("b", "TEH", "second"),
            rule("c", "teh", "third"),
        ];
        assert_eq!(apply("teh TEH Teh", &rules).text, "first SECOND First");
    }
    #[test]
    fn overlapping_occurrences_are_still_available() {
        let rules = [
            rule("a", "one one", "pair"),
            rule("b", "larger one", "lead"),
        ];
        assert_eq!(apply("larger one one one", &rules).text, "lead pair");
    }
    #[test]
    fn output_is_never_rematched_and_reprocessing_uses_the_same_source() {
        let rules = [
            rule("a", "cat", "dog"),
            rule("b", "dog", "wolf"),
            rule("c", "wolf", "cat"),
        ];
        let source = "cat dog wolf";
        assert_eq!(apply(source, &rules).text, "dog wolf cat");
        assert_eq!(apply(source, &rules).text, apply(source, &rules).text);
    }
    #[test]
    fn literal_replacement_disabled_vocabulary_and_empty_removal() {
        let mut off = rule("off", "secret", "hidden");
        off.enabled = false;
        let rules = [
            off,
            DictionaryEntry {
                id: "vocab".into(),
                word: "name".into(),
                replacement: None,
                enabled: true,
            },
            rule("remove", "filler", ""),
            rule("literal", "amount", "$1 \\ 5"),
        ];
        assert_eq!(
            apply("secret name filler amount", &rules).text,
            "secret name  $1 \\ 5"
        );
    }
    #[test]
    fn snippets_tokens_and_expansions_are_opaque_even_on_reprocessing() {
        let saved = Snippet {
            id: "snippet".into(),
            trigger: "my signature".into(),
            expansion: "cat dog NOTIPESNIPPETliteral".into(),
            enabled: true,
            date_added: 1.,
            formatting: vec![],
        };
        let rules = [
            rule("a", "cat", "dog"),
            rule("b", "dog", "wolf"),
            rule("c", "NOTIPESNIPPET", "broken"),
        ];
        let process = || {
            let plan = snippets::prepare("cat; my signature; dog", &[saved.clone()]);
            let processed = plan.map_surrounding(|text| apply(text, &rules).text);
            plan.restore(&processed)
        };
        assert_eq!(process(), "dog; cat dog NOTIPESNIPPETliteral; wolf");
        assert_eq!(process(), process());
    }
}

// This command is invoked only by the explicit Add replacement action. It must
// never overwrite an existing vocabulary entry or correction as a side effect.
#[tauri::command]
pub fn add_dictionary_correction(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<crate::engine::AppState>>,
    entry: DictionaryEntry,
) -> Result<(), String> {
    add_correction(&state.store, &entry)?;
    let _ = tauri::Emitter::emit(&app, "data-changed", ());
    Ok(())
}
fn key(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
pub fn add_correction(store: &crate::store::Store, entry: &DictionaryEntry) -> Result<(), String> {
    validate(entry)?;
    if entry
        .replacement
        .as_ref()
        .map_or(true, |s| s.trim().is_empty())
    {
        return Err("Enter the replacement text".into());
    }
    let db = store.db.lock().map_err(crate::store::err)?;
    let mut query = db
        .prepare("SELECT data FROM dictionary")
        .map_err(crate::store::err)?;
    let rows = query
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(crate::store::err)?;
    for row in rows {
        let existing: DictionaryEntry =
            serde_json::from_str(&row.map_err(crate::store::err)?).map_err(crate::store::err)?;
        if existing.id == entry.id
            && existing.word == entry.word
            && existing.replacement == entry.replacement
            && existing.enabled == entry.enabled
        {
            return Ok(());
        }
        if existing.id == entry.id || key(&existing.word) == key(&entry.word) {
            return Err(
                "This phrase is already in your dictionary. Edit the existing entry in Dictionary"
                    .into(),
            );
        }
    }
    let mut query = db
        .prepare("SELECT data FROM snippets")
        .map_err(crate::store::err)?;
    let rows = query
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(crate::store::err)?;
    for row in rows {
        let snippet: crate::snippets::Snippet =
            serde_json::from_str(&row.map_err(crate::store::err)?).map_err(crate::store::err)?;
        if crate::snippets::normalized(&snippet.trigger) == crate::snippets::normalized(&entry.word)
        {
            return Err("This phrase already triggers a snippet. Choose another phrase".into());
        }
    }
    db.execute(
        "INSERT INTO dictionary(id,data) VALUES(?1,?2)",
        rusqlite::params![
            entry.id,
            serde_json::to_string(entry).map_err(crate::store::err)?
        ],
    )
    .map_err(crate::store::err)?;
    Ok(())
}

#[cfg(test)]
mod saving_tests {
    use super::*;
    #[test]
    fn explicit_add_is_idempotent_and_does_not_overwrite_existing_entries() {
        let root =
            std::env::temp_dir().join(format!("no-tipe-dictionary-{}", uuid::Uuid::new_v4()));
        let store = crate::store::Store::open(&root).unwrap();
        let entry = DictionaryEntry {
            id: "new".into(),
            word: "teh".into(),
            replacement: Some("the".into()),
            enabled: true,
        };
        add_correction(&store, &entry).unwrap();
        add_correction(&store, &entry).unwrap();
        let duplicate = DictionaryEntry {
            id: "duplicate".into(),
            word: "TEH".into(),
            replacement: Some("other".into()),
            enabled: true,
        };
        assert!(add_correction(&store, &duplicate).is_err());
        let entries = store.list::<DictionaryEntry>("dictionary").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].replacement.as_deref(), Some("the"));
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn explicit_add_cannot_shadow_a_saved_snippet() {
        let root =
            std::env::temp_dir().join(format!("no-tipe-dictionary-{}", uuid::Uuid::new_v4()));
        let store = crate::store::Store::open(&root).unwrap();
        let snippet = crate::snippets::Snippet {
            id: "snippet".into(),
            trigger: "my signature".into(),
            expansion: "literal text".into(),
            enabled: true,
            date_added: 1.,
            formatting: vec![],
        };
        store.save_snippet(snippet).unwrap();
        let entry = DictionaryEntry {
            id: "new".into(),
            word: "MY SIGNATURE".into(),
            replacement: Some("overwrite".into()),
            enabled: true,
        };
        assert!(add_correction(&store, &entry).is_err());
        assert!(store
            .list::<DictionaryEntry>("dictionary")
            .unwrap()
            .is_empty());
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
