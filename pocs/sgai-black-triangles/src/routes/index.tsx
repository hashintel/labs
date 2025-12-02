import { createFileRoute } from '@tanstack/react-router'
import { css, cx } from '../../styled-system/css'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <div
      className={cx(
        'text-blue-500',
        css({
          fontSize: '2xl',
          fontWeight: 'bold',
          height: '100vh',
          width: '100vw',
          backgroundColor: '[lightgreen]',
          d: 'flex',
          gap: '[10px]',
        }),
      )}
    >
      Hello 🐼!
      <p className={css({ h: 'sm', bg: 'red.9' })}>Hello 🐼!</p>
      <p className={css({ h: 'sm', bg: 'red.9' })}>Hello 🐼!</p>
      <p className={css({ h: 'sm', bg: 'red.9' })}>Hello 🐼!</p>
    </div>
  )
}
