import type { ClaimedRoutine, EmailMessage, EmailPage } from "./api";

type DigestDependencies = {
  fetchPage: (input: { since: number; until: number; pageToken?: string }) => Promise<EmailPage>;
  getSeenIds: (mailboxEmail: string, ids: string[]) => Promise<string[]>;
  summarize: (messages: EmailMessage[]) => Promise<string>;
};

// 모든 페이지와 요약이 성공한 뒤에만 호출자가 체크포인트를 확정합니다.
export async function prepareEmailDigest(
  routine: Pick<ClaimedRoutine, "checkpoint" | "mailboxEmail">,
  until: number,
  deps: DigestDependencies
): Promise<{
  report: string;
  checkpoint: number;
  mailboxEmail: string;
  messageIds: string[];
  hasNewMessages: boolean;
}> {
  const since = Math.max(0, routine.checkpoint - (routine.mailboxEmail ? 120000 : 0));
  const unique = new Map<string, EmailMessage>();
  const visited = new Set<string>();
  let pageToken: string | undefined;
  let account = "";
  for (let page = 0; ; page += 1) {
    if (page >= 20) {
      const narrowerUntil = Math.floor((routine.checkpoint + until) / 2);
      if (narrowerUntil <= routine.checkpoint + 1000)
        throw new Error(
          "새 메일이 한 번에 처리할 수 있는 범위를 넘었습니다. 메일 조회 범위를 확인해 주세요. 체크포인트는 유지됩니다."
        );
      return prepareEmailDigest(routine, narrowerUntil, deps);
    }
    const result = await deps.fetchPage({ since, until, pageToken });
    if (result.since !== since || result.until !== until)
      throw new Error("이메일 조회 기간이 변경되었습니다.");
    if (
      !result.accountEmail ||
      (account && account !== result.accountEmail) ||
      (routine.mailboxEmail && routine.mailboxEmail !== result.accountEmail)
    )
      throw new Error(
        "이메일 계정이 변경되었습니다. 기존 업무를 삭제하고 새 계정의 업무를 등록해 주세요."
      );
    account = result.accountEmail;
    for (const message of result.messages) {
      if (message.receivedAt >= since && message.receivedAt < until)
        unique.set(message.id, message);
    }
    if (!result.nextPageToken) break;
    if (visited.has(result.nextPageToken))
      throw new Error("이메일 페이지가 반복되었습니다. 다시 시도해 주세요.");
    visited.add(result.nextPageToken);
    pageToken = result.nextPageToken;
  }
  const seen = new Set(await deps.getSeenIds(account, [...unique.keys()]));
  const messages = [...unique.values()]
    .filter((message) => !seen.has(message.id))
    .sort((a, b) => a.receivedAt - b.receivedAt);
  const summaries: string[] = [];
  for (let offset = 0; offset < messages.length; offset += 15) {
    const summary = (await deps.summarize(messages.slice(offset, offset + 15))).trim();
    if (!summary) throw new Error("이메일 요약이 비어 있어 재시도합니다.");
    summaries.push(summary.slice(0, 12000));
  }
  return {
    report: messages.length
      ? "새 이메일 " + messages.length + "개\n\n" + summaries.join("\n\n---\n\n")
      : "새 이메일이 없습니다.",
    checkpoint: until,
    mailboxEmail: account,
    messageIds: [...unique.keys()],
    hasNewMessages: messages.length > 0,
  };
}
