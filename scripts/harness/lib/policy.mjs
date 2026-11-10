// プロジェクト固有の決まりのうち、ガード、git hooks、CI の複数で使うもの。
// 根拠は CLAUDE.md の「守ること」と docs/contexts/hackathon.md。

// 提出用リポジトリ（公開）。開発用の履歴には内部資料があるので、ここへは人が手順どおりに出す
export const SUBMISSION_REMOTE = /df-2026-t140|Devfest-Hackathon-2026/i

// 提出用に出さない内部資料。移した前の場所も残す（過去のコミットに残っているため）。
// 提出の手順（docs/process/submission.md）と npm run submission:check がこの一覧を使う。
export const INTERNAL_PATHS = [
  // 今の場所
  'docs/contexts/',
  'docs/ui/screen-flow/',
  'docs/architecture/sources/',
  'docs/work/',
  'todo/',
  // 2026-11-07 に docs/ を整理する前の場所
  'transcripts/',
  'docs/sources/',
  'docs/team.md',
]

// プロダクトに入れない他社 AI の SDK（他社 AI を前面に出すと審査対象外）。
// 開発に使う AI（Claude Code など）は対象外で、ここで見るのはプロダクトの依存だけ。
export const OTHER_AI_PACKAGES =
  /^(openai|@openai\/.+|@anthropic-ai\/.+|anthropic|@mistralai\/.+|mistralai|cohere-ai|@cohere\/.+|replicate|groq-sdk|@groq\/.+|ollama|@huggingface\/inference|@tripo3d\/.+|tripo.*|meshy.*|@aws-sdk\/client-bedrock.*|@azure\/openai|together-ai|@langchain\/(openai|anthropic|mistralai|cohere|groq))$/

// 費用がかかる API の直接呼び出し（Vertex AI、Gemini API、Maps Platform）
export const PAID_API_HOSTS = /\b(aiplatform|generativelanguage|places|routes|maps|routeoptimization)\.googleapis\.com\b/i

// Cloud の Gemini を本物で呼ぶ切り替え。人の許可が出るまで AI は使わない
export const PAID_AI_SWITCH = /\b(USE_REAL_GEMINI\s*=\s*['"]?true|GEMINI_PROVIDER\s*=\s*['"]?vertex)\b/i

// PR を通さず main に直接 commit・push してよい場所（人の判断の記録）。main への push ではデプロイは走らない（本番へ出すのは人が deploy ブランチへ反映したときだけ）。
// 判断はすぐ全員の AI に届いてほしいため。Takana の指示（todo/humans/2026-11-07-humans-direct-main.md）
export const DIRECT_TO_MAIN_PATHS = ['todo/humans/']
export const isDirectToMainPath = (path) => DIRECT_TO_MAIN_PATHS.some((prefix) => String(path).replaceAll('\\', '/').replace(/^\.\//, '').startsWith(prefix))
// 変更が 1 つ以上あり、すべてが直接入れてよい場所にあるか
export const onlyDirectToMain = (files) => Array.isArray(files) && files.length > 0 && files.every(isDirectToMainPath)
