use rusqlite::Connection;
use std::path::PathBuf;

pub struct AppState {
    pub db_path: PathBuf,
}

impl AppState {
    pub fn open_connection(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path).map_err(|error| error.to_string())
    }
}
