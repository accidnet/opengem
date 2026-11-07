use crate::app_state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterItem {
    id: String,
    name: String,
    image: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterInput {
    id: Option<String>,
    name: String,
    image: String,
}

fn list(connection: &Connection) -> Result<Vec<CharacterItem>, String> {
    let mut statement = connection
        .prepare("SELECT id, name, image FROM characters ORDER BY rowid")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(CharacterItem {
                id: row.get(0)?,
                name: row.get(1)?,
                image: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn validate_image(image: &str) -> Result<(), String> {
    // 이미지는 DB에 저장하므로 크기와 형식을 제한합니다.
    let (header, payload) = image
        .split_once(',')
        .ok_or("지원하지 않는 이미지 형식입니다.")?;
    if !matches!(
        header,
        "data:image/png;base64"
            | "data:image/jpeg;base64"
            | "data:image/webp;base64"
            | "data:image/gif;base64"
    ) || payload.len() > 2_800_000
    {
        return Err("PNG, JPEG, WebP 또는 GIF 이미지를 2MB 이하로 선택해 주세요.".into());
    }
    let data = STANDARD
        .decode(payload)
        .map_err(|_| "이미지를 읽을 수 없습니다.")?;
    let valid = match header {
        "data:image/png;base64" => data.starts_with(b"\x89PNG\r\n\x1a\n"),
        "data:image/jpeg;base64" => data.starts_with(b"\xff\xd8\xff"),
        "data:image/gif;base64" => data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a"),
        "data:image/webp;base64" => {
            data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP"
        }
        _ => false,
    };
    if !valid || data.len() > 2 * 1024 * 1024 {
        return Err("이미지 내용이 올바르지 않거나 2MB를 초과합니다.".into());
    }
    Ok(())
}

fn save(connection: &Connection, input: CharacterInput) -> Result<CharacterItem, String> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("캐릭터 이름은 1~80자로 입력해 주세요.".into());
    }
    let existing = match input.id.as_deref() {
        Some(id) => Some(
            connection
                .query_row("SELECT image FROM characters WHERE id = ?1", [id], |row| {
                    row.get::<_, String>(0)
                })
                .optional()
                .map_err(|e| e.to_string())?
                .ok_or("수정할 캐릭터가 없습니다.")?,
        ),
        None => None,
    };
    if existing.as_deref() != Some(input.image.as_str()) || !input.image.starts_with("builtin:") {
        validate_image(&input.image)?;
    }
    let id = input.id.unwrap_or_else(|| {
        format!(
            "character-{}",
            rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(24)
                .map(char::from)
                .collect::<String>()
        )
    });
    connection.execute("INSERT INTO characters (id, name, image) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET name = excluded.name, image = excluded.image", params![id, name, input.image]).map_err(|e| e.to_string())?;
    Ok(CharacterItem {
        id,
        name: name.to_string(),
        image: input.image,
    })
}

fn delete(connection: &mut Connection, id: &str) -> Result<(), String> {
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    transaction
        .execute(
            "UPDATE operation_mode_agents SET character_id = NULL WHERE character_id = ?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
    let deleted = transaction
        .execute("DELETE FROM characters WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if deleted == 0 {
        return Err("삭제할 캐릭터가 없습니다.".into());
    }
    transaction.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_characters(state: State<AppState>) -> Result<Vec<CharacterItem>, String> {
    list(&state.open_connection()?)
}

#[tauri::command]
pub fn save_character(
    state: State<AppState>,
    input: CharacterInput,
) -> Result<CharacterItem, String> {
    save(&state.open_connection()?, input)
}

#[tauri::command]
pub fn delete_character(state: State<AppState>, id: String) -> Result<(), String> {
    delete(&mut state.open_connection()?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::run_migrations;

    #[test]
    fn library_delete_clears_agent_and_does_not_reseed() {
        let mut db = Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        assert_eq!(list(&db).unwrap().len(), 3);
        let agent: String = db
            .query_row(
                "SELECT character_id FROM operation_mode_agents ORDER BY id LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        delete(&mut db, &agent).unwrap();
        let selected: Option<String> = db
            .query_row(
                "SELECT character_id FROM operation_mode_agents ORDER BY id LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(selected.is_none());
        run_migrations(&mut db).unwrap();
        assert_eq!(list(&db).unwrap().len(), 2);
    }

    #[test]
    fn rejects_bad_upload_and_preserves_existing_image() {
        let mut db = Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        assert!(save(
            &db,
            CharacterInput {
                id: None,
                name: "x".into(),
                image: "data:image/png;base64,Zm9v".into()
            }
        )
        .is_err());
        let updated = save(
            &db,
            CharacterInput {
                id: Some("chiikawa".into()),
                name: "치이".into(),
                image: "builtin:chiikawa".into(),
            },
        )
        .unwrap();
        assert_eq!(updated.name, "치이");
    }

    #[test]
    fn custom_image_can_be_added_and_reloaded() {
        let mut db = Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        let image = "data:image/png;base64,iVBORw0KGgo=".to_string();
        let saved = save(
            &db,
            CharacterInput {
                id: None,
                name: " 나만의 캐릭터 ".into(),
                image: image.clone(),
            },
        )
        .unwrap();
        let loaded = list(&db)
            .unwrap()
            .into_iter()
            .find(|item| item.id == saved.id)
            .unwrap();
        assert_eq!(loaded.name, "나만의 캐릭터");
        assert_eq!(loaded.image, image);
        delete(&mut db, &saved.id).unwrap();
        assert!(list(&db).unwrap().iter().all(|item| item.id != saved.id));
    }
}
