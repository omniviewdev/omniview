import { ApolloSandbox } from '@apollo/sandbox/react';
import styled from '@emotion/styled';

import Layout from '@/layouts/core/sidenav';

const StyledSandbox = styled(ApolloSandbox)`
  & {
    width: 100%;
    height: 100%;
  }
`;

export default function ApolloSandboxPage() {

  return (
    <Layout.Root
      sx={{
        p: 0,
        gap: 0,
        width: '100%',
      }}
    >
      <Layout.Main>
        <StyledSandbox />
      </Layout.Main>
    </Layout.Root>
  );
}
