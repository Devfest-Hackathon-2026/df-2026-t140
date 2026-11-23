import { translate as t } from '@/shared/lib'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './Button'
import { ErrorText, Screen } from './layout'

/** 描画中の例外で画面が真っ白にならないよう、開き直すボタンを出す */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Screen>
        <ErrorText>{t('画面を表示できませんでした。開き直してください。', 'Could not display this screen. Reload the app.')}</ErrorText>
        <Button onClick={() => location.reload()}>{t('開き直す', 'Reload')}</Button>
      </Screen>
    )
  }
}
