/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { MyButton } from '../src'

test('button', () => {
  render(<MyButton type="primary" />)

  const buttonElement = screen.getByText(/my button/i)

  expect(buttonElement).toBeInTheDocument()
  expect(buttonElement).toHaveTextContent('my button type: primary count: 0')
  expect(buttonElement.outerHTML).toMatchInlineSnapshot(`"<button class="my-button">my button<br> type: primary<br> count: 0</button>"`)

  expect(buttonElement).toHaveClass('my-button')
})
