import { translate as t } from '@/shared/lib'
import { useId } from 'react'
import { Button, ErrorText, TextInput } from '@/shared/ui'
import { useJoinByCode } from '../model/useJoinByCode'
import styles from './JoinByCodeForm.module.css'

interface Props {
  /** 合言葉の旅が見つかったときに、旅の ID を渡して呼ぶ */
  onFound: (tripId: string) => void
}

/** 旅の合言葉を入れて、その旅を開く入力（M01）。招待リンクを開けないとき（ホーム画面に置いたアプリの中など）に使う */
export function JoinByCodeForm({ onFound }: Props) {
  const { code, setCode, problem, sending, submit } = useJoinByCode(onFound)
  const inputId = useId()

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      {/* ラベルは入力欄とボタンの行の上に全幅で置く。行の中に置くと、狭い幅（320px）の英語で折れる */}
      <label className={styles.label} htmlFor={inputId}>
        {t('旅の合言葉で参加する', 'Join with a trip code')}
      </label>
      <div className={styles.row}>
        <div className={styles.code}>
          <TextInput
            id={inputId}
            name="joinCode"
            value={code}
            // 途中に空白やハイフンを入れても送れるよう、少し長く受ける
            maxLength={12}
            placeholder={t('例：K7M2PX', 'e.g. K7M2PX')}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
        {/* ラベルは htmlFor で入力欄だけに結び付く（押すと入力欄に移る。ボタンには移らない） */}
        <Button type="submit" variant="go" disabled={sending}>
          {sending ? t('探しています…', 'Looking up trip…') : t('旅を開く', 'Open trip')}
        </Button>
      </div>
      <p className={styles.hint}>{t('合言葉は、招待してくれた人の「友達を招待しよう」の画面に出ています。', 'The person who invited you can find the trip code on their invite screen.')}</p>
      <ErrorText>{problem}</ErrorText>
    </form>
  )
}
