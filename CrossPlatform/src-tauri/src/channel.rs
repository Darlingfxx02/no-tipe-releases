//! Distribution identity is compiled in; settings cannot cross update channels.
pub const DEVELOPER: bool = cfg!(feature = "dev-channel");
pub const NAME: &str = if DEVELOPER { "No Type Dev" } else { "No Type" };
pub const IDENTIFIER: &str = if DEVELOPER { "app.no-tipe.desktop.dev" } else { "app.no-tipe.desktop" };
pub const RELEASE_REPOSITORY: &str = if DEVELOPER { "Darlingfxx02/no-tipe-dev-releases" } else { "Darlingfxx02/no-tipe-releases" };
pub const VERSION: &str = env!("NO_TYPE_APP_VERSION");

#[cfg(feature = "dev-channel")]
pub const UPDATER_KEY: &str = include_str!("../../updater-dev.pub");
#[cfg(not(feature = "dev-channel"))]
pub const UPDATER_KEY: &str = include_str!("../../updater.pub");
