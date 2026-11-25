use super::*;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSchedule {
    id: Option<String>,
    mode_name: String,
    agent_id: Option<String>,
    title: String,
    kind: String,
    instruction: String,
    interval_minutes: i64,
    first_run_at: Option<i64>,
}

#[tauri::command]
pub fn list_schedules(state: State<AppState>) -> Result<Vec<AgentRoutine>, String> {
    let connection = state.open_connection()?;
    let mut statement = connection.prepare(&format!("SELECT {ROUTINE_COLUMNS} FROM agent_routines r JOIN operation_modes m ON r.mode_id = m.id ORDER BY r.enabled DESC, r.next_run_at, r.id"))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], routine_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<_, _>>()
        .map_err(|error| error.to_string())
}

fn save(
    connection: &mut Connection,
    input: SaveSchedule,
    now: i64,
) -> Result<AgentRoutine, String> {
    let title = input.title.trim();
    let instruction = input.instruction.trim();
    if title.is_empty() || title.chars().count() > 120 {
        return Err("예약 이름을 1~120자로 입력해 주세요.".to_string());
    }
    if instruction.is_empty() || instruction.len() > 8_000 {
        return Err("예약 지시는 비어 있지 않은 8,000바이트 이내의 내용이어야 합니다.".to_string());
    }
    if !matches!(input.kind.as_str(), "prompt" | "email")
        || !(5..=10_080).contains(&input.interval_minutes)
    {
        return Err("작업 종류와 예약 간격(5분~7일)을 확인해 주세요.".to_string());
    }
    if input
        .first_run_at
        .is_some_and(|time| !(1..=253402300799999).contains(&time))
    {
        return Err("첫 실행 일시를 확인해 주세요.".to_string());
    }
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let mode_id = match input.agent_id.as_deref() {
        Some(id) => agent_mode_id(&tx, &input.mode_name, id)?,
        None => tx
            .query_row(
                "SELECT id FROM operation_modes WHERE mode_name = ?1",
                [&input.mode_name],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "오퍼레이션 모드를 찾을 수 없습니다.".to_string())?,
    };
    let id = if let Some(id) = input.id {
        // 대상·종류를 바꿔 기존 예약 기록이 다른 대상에게 노출되지 않도록 합니다.
        let changed = tx
            .execute(
                "UPDATE agent_routines SET title=?1, instruction=?2, interval_minutes=?3,
            scheduled_at=COALESCE(?4,scheduled_at), next_run_at=COALESCE(?4,next_run_at),
            last_error=NULL, lease_id=NULL, lease_expires_at=NULL
            WHERE id=?5 AND mode_id=?6 AND agent_id IS ?7 AND kind=?8",
                params![
                    title,
                    instruction,
                    input.interval_minutes,
                    input.first_run_at,
                    id,
                    mode_id,
                    input.agent_id,
                    input.kind
                ],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("원래 대상에서 변경할 예약을 찾을 수 없습니다.".to_string());
        }
        id
    } else {
        let id = new_id("schedule");
        let first = input
            .first_run_at
            .unwrap_or(now + input.interval_minutes * 60_000);
        tx.execute("INSERT INTO agent_routines
            (id,mode_id,agent_id,title,kind,instruction,interval_minutes,checkpoint,scheduled_at,next_run_at)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
            params![id, mode_id, input.agent_id, title, input.kind, instruction, input.interval_minutes, now, first]).map_err(|e| e.to_string())?;
        id
    };
    let schedule = tx.query_row(&format!("SELECT {ROUTINE_COLUMNS} FROM agent_routines r JOIN operation_modes m ON m.id=r.mode_id WHERE r.id=?1"), [id], routine_from_row).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(schedule)
}

#[tauri::command]
pub fn save_schedule(state: State<AppState>, input: SaveSchedule) -> Result<AgentRoutine, String> {
    save(&mut state.open_connection()?, input, now_millis())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScheduleAction {
    Run,
    Pause,
    Resume,
    Delete,
}

#[tauri::command]
pub fn change_schedule(
    state: State<AppState>,
    id: String,
    action: ScheduleAction,
) -> Result<(), String> {
    let connection = state.open_connection()?;
    let count = match action {
        ScheduleAction::Run => connection.execute(
            "UPDATE agent_routines SET next_run_at=?2 WHERE id=?1 AND enabled=1 AND (lease_expires_at IS NULL OR lease_expires_at<=?2)
             AND (agent_id IS NULL OR EXISTS (SELECT 1 FROM operation_mode_agents a WHERE a.mode_id=agent_routines.mode_id AND a.agent_id=agent_routines.agent_id AND a.is_active=1))", params![id, now_millis()]),
        ScheduleAction::Pause => connection.execute("UPDATE agent_routines SET enabled=0, lease_id=NULL, lease_expires_at=NULL WHERE id=?1", [&id]),
        ScheduleAction::Resume => connection.execute("UPDATE agent_routines SET enabled=1 WHERE id=?1", [&id]),
        ScheduleAction::Delete => connection.execute("DELETE FROM agent_routines WHERE id=?1", [&id]),
    }.map_err(|e| e.to_string())?;
    if count == 0 {
        return Err(
            "예약을 변경할 수 없습니다. 예약과 대상의 활성 상태 및 실행 여부를 확인해 주세요."
                .to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn list_schedule_reports(
    state: State<AppState>,
    id: String,
) -> Result<Vec<AgentReport>, String> {
    let connection = state.open_connection()?;
    let mut statement = connection.prepare("SELECT id, routine_id, content, created_at, status FROM agent_reports WHERE routine_id=?1 ORDER BY created_at DESC, id DESC LIMIT 30").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([id], report_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::run_migrations;

    fn new_input(agent_id: Option<String>, first_run_at: i64) -> SaveSchedule {
        SaveSchedule {
            id: None,
            mode_name: "Orchestration".into(),
            agent_id,
            title: "진행 상황".into(),
            kind: "prompt".into(),
            instruction: "최근 논의의 진행 상황을 요약해 줘".into(),
            interval_minutes: 5,
            first_run_at: Some(first_run_at),
        }
    }

    #[test]
    fn running_schedule_keeps_its_context_when_another_mode_takes_its_name() {
        let mut db = Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        db.execute_batch("INSERT INTO chat_sessions(id,title,created_at,updated_at,mode_name) VALUES ('team','대화',1,1,'Orchestration');
          INSERT INTO chat_messages(id,session_id,message_order,side,type,text,created_at) VALUES ('before','team',1,'user','text','원래 팀의 논의',1)").unwrap();
        let schedule = save(&mut db, new_input(None, 1000), 1).unwrap();
        let job = claim_due(&mut db, 1000).unwrap().remove(0);
        db.execute_batch("UPDATE operation_modes SET mode_name='Renamed' WHERE mode_name='Orchestration';
          UPDATE chat_sessions SET mode_name='Renamed' WHERE mode_name='Orchestration';
          INSERT INTO operation_modes(mode_name, display_order) VALUES('Orchestration',1);
          INSERT INTO chat_sessions(id,title,created_at,updated_at,mode_name) VALUES ('replacement','대화',1,1,'Orchestration');
          INSERT INTO chat_messages(id,session_id,message_order,side,type,text,created_at) VALUES ('after','replacement',1,'user','text','다른 팀의 논의',1)").unwrap();
        assert_eq!(job.recent_conversations, "[user] 원래 팀의 논의");
        complete_routine(
            &mut db,
            CompleteRoutineInput {
                routine_id: schedule.id.clone(),
                lease_id: job.lease_id,
                report: job.recent_conversations,
                checkpoint: None,
                error: None,
                mailbox_email: None,
                message_ids: vec![],
            },
            1100,
        )
        .unwrap();
        let report: (String,String) = db.query_row("SELECT m.mode_name,p.content FROM agent_reports p
          JOIN agent_routines r ON r.id=p.routine_id JOIN operation_modes m ON m.id=r.mode_id WHERE r.id=?1",
          [&schedule.id], |r| Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(report, ("Renamed".into(), "[user] 원래 팀의 논의".into()));
    }

    #[test]
    fn mode_and_agent_jobs_keep_separate_identity_and_anchored_cadence() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        run_migrations(&mut db).unwrap();
        let agent_id: String = db
            .query_row(
                "SELECT agent_id FROM operation_mode_agents LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        db.execute("INSERT INTO agent_memories(mode_id, agent_id, content, updated_at)
                    SELECT mode_id,agent_id,'개인 기억',1 FROM operation_mode_agents WHERE agent_id=?1", [&agent_id]).unwrap();
        for (session, owner, note) in [
            ("team", None, "모드의 업무"),
            ("personal", Some(&agent_id), "개인 업무"),
        ] {
            db.execute("INSERT INTO chat_sessions(id,title,created_at,updated_at,mode_name,agent_id) VALUES (?1,'대화',1,1,'Orchestration',?2)", params![session, owner]).unwrap();
            db.execute("INSERT INTO chat_messages(id,session_id,message_order,side,type,text,created_at) VALUES (?1,?1,1,'user','text',?2,1)", params![session,note]).unwrap();
        }
        let mode = save(&mut db, new_input(None, 1000), 1).unwrap();
        let personal = save(&mut db, new_input(Some(agent_id.clone()), 2000), 1).unwrap();
        let another = save(&mut db, new_input(Some(agent_id.clone()), 3000), 1).unwrap();
        assert_ne!(personal.id, another.id);
        update_routine_enabled(&db, "Orchestration", &agent_id, &personal.id, false).unwrap();
        update_routine_enabled(&db, "Orchestration", &agent_id, &personal.id, true).unwrap();
        let next: i64 = db
            .query_row(
                "SELECT next_run_at FROM agent_routines WHERE id=?1",
                [&personal.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(next, 2000);
        assert!(claim_due(&mut db, 999).unwrap().is_empty());
        let job = claim_due(&mut db, 301050).unwrap().remove(0);
        assert_eq!(job.routine.id, mode.id);
        assert_eq!(job.routine.agent_id, None);
        assert!(job.memory.is_empty());
        assert_eq!(job.recent_conversations, "[user] 모드의 업무");
        // 늦게 실행하거나 수동으로 일찍 실행해도 00:00:01의 5분 간격을 지킵니다.
        complete_routine(
            &mut db,
            CompleteRoutineInput {
                routine_id: job.routine.id.clone(),
                lease_id: job.lease_id,
                report: "모드 보고서".into(),
                checkpoint: None,
                error: None,
                mailbox_email: None,
                message_ids: vec![],
            },
            301100,
        )
        .unwrap();
        let next: i64 = db
            .query_row(
                "SELECT next_run_at FROM agent_routines WHERE id=?1",
                [&mode.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(next, 601000);
        let job = claim_due(&mut db, 301100).unwrap().remove(0);
        assert_eq!(job.routine.id, personal.id);
        assert_eq!(job.routine.agent_id, Some(agent_id.clone()));
        assert_eq!(job.memory, "개인 기억");
        assert_eq!(job.recent_conversations, "[user] 개인 업무");
        let mut edit = new_input(None, 900000);
        edit.id = Some(personal.id.clone());
        assert!(save(&mut db, edit, 301200).is_err());
        let mut edit = new_input(Some(agent_id), 900000);
        edit.id = Some(personal.id.clone());
        save(&mut db, edit, 301200).unwrap();
        assert!(complete_routine(
            &mut db,
            CompleteRoutineInput {
                routine_id: personal.id,
                lease_id: job.lease_id,
                report: "오래된 보고서".into(),
                checkpoint: None,
                error: None,
                mailbox_email: None,
                message_ids: vec![],
            },
            301201
        )
        .is_err());
        db.execute("DELETE FROM operation_modes", []).unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM agent_reports", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
