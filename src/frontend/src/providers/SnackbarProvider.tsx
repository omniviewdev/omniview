import React, { createContext, useContext, ReactNode } from 'react';
import { VariantType, useSnackbar as useNotistackSnackbar } from 'notistack';
import Alert from '@mui/joy/Alert';
import { ColorPaletteProp, IconButton } from '@mui/joy';
import { LuCheckCircle, LuAlertTriangle, LuAlertCircle, LuInfo, LuX } from 'react-icons/lu';
import Icon from '@/components/icons/Icon';

interface ISnackbarContext {
  showSnackbar: (message: string, status: VariantType) => void;
}

const SnackbarContext = createContext<ISnackbarContext | undefined>(undefined);

interface SnackbarProviderProps {
  children: ReactNode;
}

type SnackbarContent = {
  color: ColorPaletteProp;
  icon: ReactNode;
};

const snackbarContent: Record<VariantType, SnackbarContent> = {
  default: {
    color: 'success',
    icon: <LuCheckCircle />,
  },
  success: {
    color: 'success',
    icon: <LuCheckCircle />,
  },
  error: {
    color: 'danger',
    icon: <LuAlertCircle />,
  },
  warning: {
    color: 'warning',
    icon: <LuAlertTriangle />,
  },
  info: {
    color: 'neutral',
    icon: <LuInfo />,
  },
};


export const SnackbarProvider: React.FC<SnackbarProviderProps> = ({ children }) => {
  const { enqueueSnackbar, closeSnackbar } = useNotistackSnackbar();

  const showSnackbar = (message: string, status: VariantType = 'default', icon?: string) => {
    enqueueSnackbar(message, {
      variant: status,
      anchorOrigin: {
        vertical: 'bottom',
        horizontal: 'right',
      },
      autoHideDuration: 3000,
      content: (key, message) => (
        <Alert
          variant="soft"
          color={snackbarContent[status].color}
          startDecorator={icon ? <Icon name={icon} /> : snackbarContent[status].icon}
          endDecorator={
            <IconButton size="sm" variant="soft" color={snackbarContent[status].color} onClick={() => closeSnackbar(key)}>
              <LuX />
            </IconButton>
          }
        >
          {message}
        </Alert>
      ),
    });
  };

  return (
    <SnackbarContext.Provider value={{ showSnackbar }}>
      {children}
    </SnackbarContext.Provider>
  );
};

export const useSnackbar = (): ISnackbarContext => {
  const context = useContext(SnackbarContext);
  if (context === undefined) {
    throw new Error('useCustomSnackbar must be used within a CustomSnackbarProvider');
  }
  return context;
};


