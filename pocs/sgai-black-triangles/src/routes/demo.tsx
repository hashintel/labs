import { createFileRoute, Outlet } from '@tanstack/react-router'
import Header from '../components/Header'

export const Route = createFileRoute('/demo')({
  component: DemoLayout,
})

function DemoLayout() {
  return (
    <>
      <Header />
      <Outlet />
    </>
  )
}
