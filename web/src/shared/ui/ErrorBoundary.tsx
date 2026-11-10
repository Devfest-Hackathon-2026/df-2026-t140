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
        <ErrorText>画面を表示できませんでした。開き直してください。</ErrorText>
        <Button onClick={() => location.reload()}>開き直す</Button>
      </Screen>
    )
  }
}
