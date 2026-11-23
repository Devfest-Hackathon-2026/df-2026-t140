import { translate } from '../../../shared/lib/language.ts'
/**
 * 建った建物の場所カードの、状態の一言。
 * builder は建てた人の名前、builderIsWisher は希望を書いた人が自分で建てたか、generated は Gemini（argon）が作った模型か。
 * 希望を書いた人が自分で建てたなら、すぐ上の希望の行と同じ人なので、名前を繰り返さない（かめの判断、2026-11-19）。
 * 建てた人が抜けて名前が分からないときも同じで、用意した部品の模型のときだけ、そのことを書く。何も言うことがなければ undefined（欄を出さない）
 */
export function builtState(builder: string | null, builderIsWisher: boolean, generated: boolean): string | undefined {
  if (builder && !builderIsWisher) return translate(`${builder}が建てました${generated ? '' : '（用意した部品の模型です）'}`, `Built by ${builder}${generated ? '' : ' using a pre-made model'}.`)
  return generated ? undefined : translate('用意した部品の模型です', 'Built using a pre-made model.')
}
