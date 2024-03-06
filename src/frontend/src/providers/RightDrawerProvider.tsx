import React, { useState, useCallback, ReactNode, useMemo, memo } from 'react';

// material-ui
import Drawer from '@mui/joy/Drawer';
import DialogTitle from '@mui/joy/DialogTitle';
import DialogContent from '@mui/joy/DialogContent';
import ModalClose from '@mui/joy/ModalClose';
import Sheet from '@mui/joy/Sheet';

// icons
import { LuNetwork, LuServer, LuContainer, LuDatabase, LuCloudLightning, LuGroup, LuCpu, LuFileJson2, LuShield } from "react-icons/lu";

// 3rd party
import MonacoEditor from '@monaco-editor/react'; // Ensure this package is installed
import { stringify } from 'yaml'

// context
import RightDrawerContext, { RightDrawerContextType, DrawerContent } from '@/contexts/RightDrawerContext';
import { Stack } from '@mui/joy';

interface RightDrawerProviderProps {
  children: ReactNode;
}

const GetResourceSpecIcon = (type: string) => {
  switch (type) {
    case 'node':
      return <LuCpu />;
    case 'pod':
      return <LuContainer />;
    case 'namespace':
      return <LuGroup />;
    case 'deployment':
    case 'replicaset':
    case 'statefulset':
    case 'daemonset':
    case 'job':
    case 'cronjob':
      return <LuServer />;
    case 'service':
    case 'ingress':
    case 'endpoint':
    case 'endpointslice':
    case 'networkpolicy':
      return <LuNetwork />;
    case 'persistentvolume':
    case 'persistentvolumeclaim':
    case 'storageclass':
    case 'volumeattachment':
      return <LuDatabase />;
    case 'configmap':
    case 'secret':
      return <LuFileJson2 />;
    case 'role':
    case 'rolebinding':
    case 'clusterrole':
    case 'clusterrolebinding':
      return <LuShield />;
    case 'event':
      return <LuCloudLightning />;
    default:
      return <React.Fragment />;
  }
}

type ContentRendererProps = {
  type: string;
  content: DrawerContent;
}

const ContentRenderer: React.FC<ContentRendererProps> = memo(({ type, content }) => {
  switch (type) {
    case 'spec':
      return (
        <MonacoEditor
          defaultLanguage="yaml"
          theme="vs-dark"
          value={stringify(content, null, 2)}
          options={{
            readOnly: true,
            fontSize: 11,
          }}
        />
      );
    case 'children':
      return <>{content}</>;
    default:
      return <div>No view type selected</div>;
  }
});

const RightDrawerProvider: React.FC<RightDrawerProviderProps> = ({ children }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [title, setTitle] = useState<string>('');
  const [titleIcon, setTitleIcon] = useState<ReactNode>(<React.Fragment />);
  const [drawerContent, setDrawerContent] = useState<DrawerContent>({});
  const [viewType, setViewType] = useState<string>('');

  const openDrawer: RightDrawerContextType['openDrawer'] = useCallback((type, title, content) => {
    setIsOpen(true);
    setViewType(type);
    setTitle(title);
    setDrawerContent(content);
  }, []);

  const showResourceSpec: RightDrawerContextType['showResourceSpec'] = useCallback((type, title, content) => {
    setTitleIcon(GetResourceSpecIcon(type));
    openDrawer('spec', title, content);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsOpen(false);
    // I don't think the below is necessary, and it causes an additional rerender
    // // Clear the content when the drawer is closed, but with a delay to allow the drawer to close first
    // setTimeout(() => {
    //   setDrawerContent({});
    //   setTitle('');
    // }, 300);
  }, []);


  const contextValue = useMemo(() => ({
    showResourceSpec,
    openDrawer,
    closeDrawer
  }), [showResourceSpec, openDrawer, closeDrawer]);

  return (
    <RightDrawerContext.Provider value={contextValue}>
      {children}
      <Drawer
        disableEnforceFocus
        disableScrollLock
        size="lg"
        anchor='right'
        variant="plain"
        open={isOpen}
        onClose={closeDrawer}
        // hideBackdrop
        slotProps={{
          backdrop: {
            sx: {
              backgroundColor: 'transparent',
              '-webkit-backdrop-filter': 'blur(0px)',
            },
          },
          content: {
            sx: {
              maxWidth: 700,
              bgcolor: 'transparent',
              p: { md: 1, sm: 0 },
              boxShadow: 'none',
            },
          },
        }}
        sx={{
          // This ensures the drawer is an overlay that does not push content
          position: 'fixed',
          zIndex: (theme) => theme.zIndex.modal,
          // This makes the background content interactive
          '& .MuiBackdrop-root': {
            // make it transparent
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          },
        }}
      >
        <Sheet
          sx={{
            borderRadius: 'md',
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            height: '100%',
            overflow: 'auto',
            pointerEvents: 'auto',
          }}
        >
          <DialogTitle >
            <Stack direction="row" gap={1} alignItems={'center'}>
              {titleIcon}{title}
            </Stack>
          </DialogTitle>
          <ModalClose />
          <DialogContent sx={{ gap: 2 }}>
            <ContentRenderer type={viewType} content={drawerContent} />
          </DialogContent>
        </Sheet>
      </Drawer>
    </RightDrawerContext.Provider>
  );
};

export default RightDrawerProvider;
