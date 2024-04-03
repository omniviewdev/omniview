import React, { createContext, useContext, type ReactNode } from 'react';
import { type VariantType, useSnackbar as useNotistackSnackbar } from 'notistack';

// Material-ui
import Alert from '@mui/joy/Alert';
import Typography from '@mui/joy/Typography';
import IconButton from '@mui/joy/IconButton';
import Stack from '@mui/joy/Stack';
import { type ColorPaletteProp } from '@mui/joy';

// Icons
import {
  LuCheckCircle, LuAlertTriangle, LuAlertCircle, LuInfo, LuX,
} from 'react-icons/lu';
import Icon from '@/components/icons/Icon';

type SnackbarContextType = {
  showSnackbar(message: string, status: VariantType, icon?: string, details?: string): void;
  showSnackbar(options: ShowSnackbarOptions): void;
};

const SnackbarContext = createContext<SnackbarContextType | undefined>(undefined);

type SnackbarProviderProps = {
  children: ReactNode;
};

type SnackbarContent = {
  color: ColorPaletteProp;
  icon: ReactNode;
};

type ShowSnackbarOptions = {
  message: string;
  status: VariantType;
  icon?: string;
  details?: string;
  showOnce?: boolean;
  autoHideDuration?: number;
};

const snackbarContent: Record<VariantType, SnackbarContent> = {
  default: {
    color: 'primary',
    icon: <LuInfo />,
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
    color: 'primary',
    icon: <LuInfo />,
  },
};

export const SnackbarProvider: React.FC<SnackbarProviderProps> = ({ children }) => {
  const { enqueueSnackbar, closeSnackbar } = useNotistackSnackbar();

  const [singleShowNotices, setSingleShowNotices] = React.useState<string[]>([]);

  const setNoticeShown = (message: string) => {
    setSingleShowNotices([...singleShowNotices, message]);
  };

  // Updated showSnackbar function to handle both overloads
  const showSnackbar: SnackbarContextType['showSnackbar'] = (messageOrOptions: string | ShowSnackbarOptions, status?: VariantType, icon?: string, details?: string) => {
    // Determine if the function was called with ShowSnackbarOptions or individual arguments
    const isOptions = typeof messageOrOptions === 'object';

    // Extract options if provided
    let _message = '';
    let _status: VariantType = 'info';
    let _icon: string | undefined;
    let _details: string | undefined;
    let _autoHideDuration: number | undefined = 5000;

    if (isOptions) {
      _message = messageOrOptions.message;
      // before doing anything else, check to see if this is a single show
      if (messageOrOptions.showOnce) {
        if (singleShowNotices.includes(_message)) {
          // don't show again
          return;
        }

        setNoticeShown(_message);
      }

      _status = messageOrOptions.status;
      _icon = messageOrOptions.icon;
      _details = messageOrOptions.details;
      _autoHideDuration = messageOrOptions.autoHideDuration ?? 5000;
    } else {
      _message = messageOrOptions;
      _status = status!;
      _icon = icon;
      _details = details;
    }

    enqueueSnackbar(_message, {
      variant: _status,
      anchorOrigin: {
        vertical: 'bottom',
        horizontal: 'right',
      },
      preventDuplicate: true,
      autoHideDuration: _autoHideDuration,
      content: (key, message) => (
        <Alert
          variant='soft'
          sx={{
            maxWidth: 600,
          }}
          color={snackbarContent[_status].color}
          startDecorator={_icon ? <Icon name={_icon} size={20} /> : snackbarContent[_status].icon}
          endDecorator={
            <IconButton size='sm' variant='soft' color={snackbarContent[_status].color} onClick={() => {
              closeSnackbar(key);
            }}>
              <LuX />
            </IconButton>
          }
        >
          <Stack direction='column' spacing={0} alignItems='flex-start'>
            <Typography level='title-sm'>{message}</Typography>
            {Boolean(_details) && <Typography level='body-sm' color={snackbarContent[_status].color} >{_details}</Typography>}
          </Stack>
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

export const useSnackbar = (): SnackbarContextType => {
  const context = useContext(SnackbarContext);
  if (context === undefined) {
    throw new Error('useCustomSnackbar must be used within a CustomSnackbarProvider');
  }

  return context;
};

export default useSnackbar;

