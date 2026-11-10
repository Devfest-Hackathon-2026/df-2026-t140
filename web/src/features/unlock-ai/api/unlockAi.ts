import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/**
 * 合言葉を Functions に送る（functions/src/features/unlock-ai）。
 * 合えば aiAccess/{uid} ができ、自分の希望で本物の AI（Cloud の Gemini）が使われる。
 * 合言葉は端末に覚えない。断られたときは、理由の文（日本語）が入ったエラーが投げられる。
 */
export async function unlockAi(session: Session, passphrase: string): Promise<void> {
  await httpsCallable(session.functions, 'unlockAi')({ passphrase })
}
