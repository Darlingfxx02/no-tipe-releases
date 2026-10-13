use std::time::{Duration, Instant};

pub const RIGHT_CONTROL: u8 = 0xa3;
const HOLD_DELAY: Duration = Duration::from_millis(150);

#[derive(Debug, PartialEq)]
pub enum Action { Down(Instant), Up, Tap(Instant), Cancel }
struct Press { started: Instant, active: bool, chord: bool }
pub struct Gesture { keys: [bool; 256], press: Option<Press> }
impl Default for Gesture {
    fn default() -> Self { Self { keys: [false; 256], press: None } }
}
impl Gesture {
    // Keep physical key state across capture/configuration changes, so an
    // already-held Ctrl never becomes a new dictation when capture ends.
    pub fn reset(&mut self) { self.press = None; }
    pub fn key(&mut self, key: u8, down: bool, enabled: bool, now: Instant) -> Option<Action> {
        let repeat = self.keys[key as usize] == down;
        self.keys[key as usize] = down;
        if repeat { return None; }
        if key == RIGHT_CONTROL {
            if down {
                if enabled && self.keys.iter().enumerate().all(|(index, held)| index == RIGHT_CONTROL as usize || !held) {
                    self.press = Some(Press { started: now, active: false, chord: false });
                }
            } else if let Some(press) = self.press.take() {
                if press.chord { return None; }
                if press.active { return Some(Action::Up); }
                if enabled { return Some(Action::Tap(press.started)); }
            }
        } else if down {
            if let Some(press) = &mut self.press {
                press.chord = true;
                if press.active { press.active = false; return Some(Action::Cancel); }
            }
        }
        None
    }
    pub fn deadline(&self) -> Option<Instant> {
        self.press.as_ref().filter(|p| !p.active && !p.chord).map(|p| p.started + HOLD_DELAY)
    }
    pub fn activate(&mut self, enabled: bool, now: Instant) -> Option<Action> {
        if !enabled { self.reset(); return None; }
        let press = self.press.as_mut()?;
        if !press.active && !press.chord && now >= press.started + HOLD_DELAY {
            press.active = true;
            return Some(Action::Down(press.started));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_right_control_hold_starts_once_and_finishes_on_release() {
        let mut g = Gesture::default(); let now = Instant::now();
        assert_eq!(g.key(RIGHT_CONTROL, true, true, now), None);
        assert_eq!(g.activate(true, now + Duration::from_millis(149)), None);
        assert_eq!(g.activate(true, now + HOLD_DELAY), Some(Action::Down(now)));
        assert_eq!(g.key(RIGHT_CONTROL, true, true, now + HOLD_DELAY), None);
        assert_eq!(g.activate(true, now + Duration::from_secs(1)), None);
        assert_eq!(g.key(RIGHT_CONTROL, false, true, now + Duration::from_secs(1)), Some(Action::Up));
    }
    #[test]
    fn quick_taps_are_distinct_from_holds_for_toggle_and_hybrid() {
        let mut g = Gesture::default(); let now = Instant::now();
        g.key(RIGHT_CONTROL, true, true, now);
        assert_eq!(g.key(RIGHT_CONTROL, false, true, now + Duration::from_millis(60)), Some(Action::Tap(now)));
        assert_eq!(g.deadline(), None);
    }
    #[test]
    fn ctrl_c_and_altgr_never_start_dictation_in_either_key_order() {
        for other in [0x43, 0xa5, 0xa2, 0xa0, 0x5b] {
            for other_first in [false, true] {
                let mut g = Gesture::default(); let now = Instant::now();
                if other_first { g.key(other, true, true, now); }
                g.key(RIGHT_CONTROL, true, true, now);
                if !other_first { g.key(other, true, true, now); }
                assert_eq!(g.activate(true, now + Duration::from_secs(1)), None);
                g.key(other, false, true, now);
                assert_eq!(g.key(RIGHT_CONTROL, false, true, now), None);
            }
        }
    }
    #[test]
    fn a_chord_after_the_hold_cancels_once_without_inserting_a_result() {
        let mut g = Gesture::default(); let now = Instant::now();
        g.key(RIGHT_CONTROL, true, true, now); g.activate(true, now + HOLD_DELAY);
        assert_eq!(g.key(0x43, true, true, now + HOLD_DELAY), Some(Action::Cancel));
        assert_eq!(g.key(0x43, true, true, now + HOLD_DELAY), None);
        g.key(0x43, false, true, now);
        assert_eq!(g.key(RIGHT_CONTROL, false, true, now), None);
    }
    #[test]
    fn capture_reset_and_disabled_preferences_cannot_replay_held_keys() {
        let mut g = Gesture::default(); let now = Instant::now();
        g.key(RIGHT_CONTROL, true, true, now); g.reset();
        assert_eq!(g.activate(true, now + HOLD_DELAY), None);
        assert_eq!(g.key(RIGHT_CONTROL, false, true, now), None);
        g.key(RIGHT_CONTROL, true, false, now);
        assert_eq!(g.key(RIGHT_CONTROL, false, true, now), None);
    }
    #[test]
    fn changing_the_shortcut_keeps_an_active_holds_release() {
        let mut g = Gesture::default(); let now = Instant::now();
        g.key(RIGHT_CONTROL, true, true, now); g.activate(true, now + HOLD_DELAY);
        assert_eq!(g.key(RIGHT_CONTROL, false, false, now), Some(Action::Up));
    }
}
