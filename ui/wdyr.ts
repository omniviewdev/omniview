/// <reference types="@welldone-software/why-did-you-render" />

import React from 'react';

if (import.meta.env.DEV) {
  import('@welldone-software/why-did-you-render').then((wdyr) => {
    wdyr.default(React, {
      trackAllPureComponents: true,
    });
  })
}
