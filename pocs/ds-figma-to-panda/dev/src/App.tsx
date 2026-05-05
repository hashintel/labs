import React from 'react';
import { MyButton } from '../../src';
import { css } from '../../styled-system/css';

const divCss = css({ color: 'red', fontSize: '20px', _osDark: { color: 'blue' } });

export function App() {
  return (
    <>
      <div className={divCss}>Hello</div>
      <MyButton type="primary" />
    </>
  );
}
