use rusqlite::Connection;
use std::path::PathBuf;

pub struct AppState {
    pub db_path: PathBuf,
}

impl AppState {
    pub fn open_connection(&self) -> Result<Connection, String> {
        let connection = Connection::open(&self.db_path).map_err(|error| error.to_string())?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|error| error.to_string())?;
        Ok(connection)
    }
}
