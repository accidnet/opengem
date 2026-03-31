use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use walkdir::WalkDir;

const DEFAULT_FILE_LIMIT: usize = 200;
const DEFAULT_MATCH_LIMIT: usize = 50;
const MAX_FILE_SIZE_BYTES: usize = 256 * 1024;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileMatchPayload {
    path: String,
    line_number: usize,
    line: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSkillSummaryPayload {
    name: String,
    description: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCommandSummaryPayload {
    name: String,
    description: String,
    path: String,
    hints: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDocumentPayload {
    name: String,
    description: String,
    path: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandLineResultPayload {
    command: String,
    cwd: String,
    shell: String,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    combined_output: String,
    success: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCommandLineInput {
    command: String,
    cwd: Option<String>,
}

#[tauri::command]
pub fn list_workspace_files(
    project_paths: Vec<String>,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    let roots = normalize_project_paths(project_paths)?;
    let lowered_query = query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let max_items = limit.unwrap_or(DEFAULT_FILE_LIMIT).max(1);
    let mut files = Vec::new();

    for root in roots {
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| !should_skip_entry(entry.path()))
        {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            let path_str = path.to_string_lossy().to_string();
            if let Some(query) = &lowered_query {
                let normalized = path_str.to_lowercase();
                if !normalized.contains(query) {
                    continue;
                }
            }

            files.push(path_str);
            if files.len() >= max_items {
                return Ok(files);
            }
        }
    }

    Ok(files)
}

#[tauri::command]
pub fn search_workspace_text(
    project_paths: Vec<String>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<WorkspaceFileMatchPayload>, String> {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    let roots = normalize_project_paths(project_paths)?;
    let normalized_query = trimmed_query.to_lowercase();
    let max_items = limit.unwrap_or(DEFAULT_MATCH_LIMIT).max(1);
    let mut matches = Vec::new();

    'root_loop: for root in roots {
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| !should_skip_entry(entry.path()))
        {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            if !looks_like_text_file(path) {
                continue;
            }

            let content = match fs::read_to_string(path) {
                Ok(content) => content,
                Err(_) => continue,
            };

            for (index, line) in content.lines().enumerate() {
                if !line.to_lowercase().contains(&normalized_query) {
                    continue;
                }

                matches.push(WorkspaceFileMatchPayload {
                    path: path.to_string_lossy().to_string(),
                    line_number: index + 1,
                    line: line.trim().to_string(),
                });

                if matches.len() >= max_items {
                    break 'root_loop;
                }
            }
        }
    }

    Ok(matches)
}

#[tauri::command]
pub fn read_workspace_file(path: String) -> Result<String, String> {
    let normalized = normalize_existing_path(&path)?;
    let metadata = fs::metadata(&normalized).map_err(|error| error.to_string())?;
    if metadata.len() as usize > MAX_FILE_SIZE_BYTES {
        return Err("파일이 너무 커서 한 번에 읽을 수 없습니다.".to_string());
    }

    fs::read_to_string(&normalized).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_workspace_skills(
    project_paths: Vec<String>,
) -> Result<Vec<WorkspaceSkillSummaryPayload>, String> {
    let roots = normalize_project_paths(project_paths)?;
    let mut skills = Vec::new();

    for file in collect_workspace_documents(&roots, &["SKILL.md"], true)? {
        let parsed = parse_workspace_document(&file, "skill")?;
        skills.push(WorkspaceSkillSummaryPayload {
            name: parsed.name,
            description: parsed.description,
            path: file.to_string_lossy().to_string(),
        });
    }

    Ok(skills)
}

#[tauri::command]
pub fn load_workspace_skill(path: String) -> Result<WorkspaceDocumentPayload, String> {
    let file = normalize_existing_path(&path)?;
    let parsed = parse_workspace_document(&file, "skill")?;
    let content = fs::read_to_string(&file).map_err(|error| error.to_string())?;

    Ok(WorkspaceDocumentPayload {
        name: parsed.name,
        description: parsed.description,
        path: file.to_string_lossy().to_string(),
        content,
    })
}

#[tauri::command]
pub fn list_workspace_commands(
    project_paths: Vec<String>,
) -> Result<Vec<WorkspaceCommandSummaryPayload>, String> {
    let roots = normalize_project_paths(project_paths)?;
    let mut commands = Vec::new();

    for file in collect_workspace_documents(&roots, &[".md"], false)? {
        if !is_command_document(&file) {
            continue;
        }

        let parsed = parse_workspace_document(&file, "command")?;
        let content = fs::read_to_string(&file).map_err(|error| error.to_string())?;
        commands.push(WorkspaceCommandSummaryPayload {
            name: parsed.name,
            description: parsed.description,
            path: file.to_string_lossy().to_string(),
            hints: extract_command_hints(&content),
        });
    }

    Ok(commands)
}

#[tauri::command]
pub fn load_workspace_command(path: String) -> Result<WorkspaceDocumentPayload, String> {
    let file = normalize_existing_path(&path)?;
    let parsed = parse_workspace_document(&file, "command")?;
    let content = fs::read_to_string(&file).map_err(|error| error.to_string())?;

    Ok(WorkspaceDocumentPayload {
        name: parsed.name,
        description: parsed.description,
        path: file.to_string_lossy().to_string(),
        content,
    })
}

#[tauri::command]
pub fn run_command_line(input: RunCommandLineInput) -> Result<CommandLineResultPayload, String> {
    let command = input.command.trim().to_string();
    if command.is_empty() {
        return Err("실행할 명령어가 비어 있습니다.".to_string());
    }

    let cwd = match input.cwd.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => normalize_existing_path(value)?,
        None => std::env::current_dir().map_err(|error| error.to_string())?,
    };

    let (shell, args) = resolve_shell_command(&command);
    let mut process = Command::new(&shell);
    process.args(args).current_dir(&cwd);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(CREATE_NO_WINDOW);
    }

    let output = process.output().map_err(|error| error.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined_output = [stdout.as_str(), stderr.as_str()]
        .iter()
        .filter(|value| !value.trim().is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("\n");

    Ok(CommandLineResultPayload {
        command,
        cwd: cwd.to_string_lossy().to_string(),
        shell,
        exit_code: output.status.code(),
        stdout,
        stderr,
        combined_output,
        success: output.status.success(),
    })
}

fn resolve_shell_command(command: &str) -> (String, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        if let Some(shell) = find_windows_shell() {
            let lower = shell.to_ascii_lowercase();
            if lower.ends_with("pwsh.exe") || lower == "pwsh" || lower.ends_with("powershell.exe") {
                return (
                    shell,
                    vec![
                        "-NoProfile".to_string(),
                        "-NonInteractive".to_string(),
                        "-Command".to_string(),
                        command.to_string(),
                    ],
                );
            }

            return (
                shell,
                vec!["/d".to_string(), "/c".to_string(), command.to_string()],
            );
        }

        return (
            "cmd.exe".to_string(),
            vec!["/d".to_string(), "/c".to_string(), command.to_string()],
        );
    }

    #[cfg(not(target_os = "windows"))]
    {
        (
            "sh".to_string(),
            vec!["-lc".to_string(), command.to_string()],
        )
    }
}

#[cfg(target_os = "windows")]
fn find_windows_shell() -> Option<String> {
    let candidates = [
        "pwsh.exe",
        "pwsh",
        "powershell.exe",
        "powershell",
        &std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
    ];

    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.components().count() > 1 {
            if path.exists() {
                return Some(path.to_string_lossy().to_string());
            }
            continue;
        }

        if let Some(resolved) = find_in_path(candidate) {
            return Some(resolved);
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn find_in_path(executable: &str) -> Option<String> {
    let path_var = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&path_var) {
        let candidate = directory.join(executable);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}

struct ParsedWorkspaceDocument {
    name: String,
    description: String,
}

fn normalize_project_paths(project_paths: Vec<String>) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();

    for path in project_paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }

        let normalized = PathBuf::from(trimmed);
        if !normalized.exists() {
            continue;
        }

        let canonical = normalized.canonicalize().map_err(|error| error.to_string())?;
        if canonical.is_dir() {
            roots.push(canonical);
        }
    }

    if roots.is_empty() {
        return Err("탐색할 프로젝트 경로가 없습니다.".to_string());
    }

    Ok(roots)
}

fn normalize_existing_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("경로가 비어 있습니다.".to_string());
    }

    let normalized = PathBuf::from(trimmed);
    if !normalized.exists() {
        return Err(format!("경로를 찾을 수 없습니다: {trimmed}"));
    }

    normalized.canonicalize().map_err(|error| error.to_string())
}

fn should_skip_entry(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | ".next" | ".turbo"
    )
}

fn looks_like_text_file(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return true;
    };

    matches!(
        extension.to_ascii_lowercase().as_str(),
        "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "json"
            | "md"
            | "mdx"
            | "txt"
            | "rs"
            | "toml"
            | "yaml"
            | "yml"
            | "css"
            | "html"
            | "sql"
    )
}

fn collect_workspace_documents(
    roots: &[PathBuf],
    suffixes: &[&str],
    exact_file_name_only: bool,
) -> Result<Vec<PathBuf>, String> {
    let mut documents = Vec::new();

    for root in roots {
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| !should_skip_entry(entry.path()))
        {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.into_path();
            let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };

            let matches = if exact_file_name_only {
                suffixes.iter().any(|suffix| file_name.eq_ignore_ascii_case(suffix))
            } else {
                suffixes.iter().any(|suffix| file_name.ends_with(suffix))
            };

            if matches {
                documents.push(path);
            }
        }
    }

    Ok(documents)
}

fn is_command_document(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|value| {
                value.eq_ignore_ascii_case("command") || value.eq_ignore_ascii_case("commands")
            })
            .unwrap_or(false)
    })
}

fn parse_workspace_document(path: &Path, fallback_kind: &str) -> Result<ParsedWorkspaceDocument, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let file_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback_kind)
        .to_string();

    let frontmatter = parse_frontmatter(&content);
    let name = frontmatter
        .as_ref()
        .and_then(|map| map.get("name").cloned())
        .or_else(|| {
            frontmatter
                .as_ref()
                .and_then(|map| map.get("title").cloned())
        })
        .unwrap_or(file_stem.clone());

    let description = frontmatter
        .as_ref()
        .and_then(|map| map.get("description").cloned())
        .unwrap_or_else(|| extract_description_from_markdown(&content, &file_stem));

    Ok(ParsedWorkspaceDocument { name, description })
}

fn parse_frontmatter(content: &str) -> Option<std::collections::HashMap<String, String>> {
    let normalized = content.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next()? != "---" {
        return None;
    }

    let mut map = std::collections::HashMap::new();
    for line in lines {
        if line.trim() == "---" {
            return Some(map);
        }

        let (key, value) = line.split_once(':')?;
        map.insert(key.trim().to_string(), value.trim().trim_matches('"').to_string());
    }

    None
}

fn extract_description_from_markdown(content: &str, fallback: &str) -> String {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed == "---" {
            continue;
        }

        return trimmed.to_string();
    }

    format!("{fallback} 문서")
}

fn extract_command_hints(content: &str) -> Vec<String> {
    let mut hints = Vec::new();
    let bytes = content.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        if bytes[index] == b'$' {
            index += 1;
            let start = index;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                index += 1;
            }

            if start < index {
                let hint = format!("${}", &content[start..index]);
                if !hints.contains(&hint) {
                    hints.push(hint);
                }
                continue;
            }
        }

        index += 1;
    }

    if content.contains("$ARGUMENTS") && !hints.iter().any(|hint| hint == "$ARGUMENTS") {
        hints.push("$ARGUMENTS".to_string());
    }

    hints
}
