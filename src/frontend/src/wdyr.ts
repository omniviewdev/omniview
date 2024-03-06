/// <reference types="@welldone-software/why-did-you-render" />

import React from 'react';

if (import.meta.env.DEV) {
  let whyDidYouRender = await import('@welldone-software/why-did-you-render');
  whyDidYouRender.default(React, {
    trackAllPureComponents: true,
  });
}
