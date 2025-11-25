import { useState } from 'react'

interface MyButtonProps {
  type?: 'primary'
}

export const MyButton: React.FC<MyButtonProps> = ({ type }) => {
  let [count, setCount] = useState(0)
  return (
    <button className="my-button" onClick={() => setCount(count + 1)}>
      my button
      <br /> type: {type}
      <br /> count: {count}
    </button>
  )
}
