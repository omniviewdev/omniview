import { type FC, useEffect, useReducer } from 'react';
import ErrorIcon from '@mui/icons-material/Error';
import CheckCircle from '@mui/icons-material/CheckCircle';

import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text, Heading } from '@omniviewdev/ui/typography';
import { List, ListItem, ListSubheader } from '@omniviewdev/ui';

import { produce } from 'immer';
import { usePluginRouter } from '@infraview/router';

import { EventsOn } from '@omniviewdev/runtime/runtime';
import { handleRemoveTab } from '@/store/tabs/slice';
import { useDispatch } from 'react-redux';

function calculateTotalResources(resourceStates: ResourceState) {
  return Object.values(resourceStates).reduce(
    (acc, group) => acc + Object.keys(group).length,
    0,
  );
}

type ResourceState = Record<string, Record<string, {
  initialized: boolean;
  error: boolean;
  message: string;
}>>;

type AppState = {
  resourceStates: ResourceState;
  resourcesReady: number;
  totalResources: number;
};

const initialState = {
  resourceStates: {},
  resourcesReady: 0,
  totalResources: 0,
};

type AppAction =
  | { type: 'MARK_RESOURCE_READY'; payload: string }
  | { type: 'MARK_RESOURCE_ERROR'; payload: string }
  | { type: 'SET_RESOURCES'; payload: { resources: Record<string, boolean> } };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'MARK_RESOURCE_READY': {
      console.log('MARK_RESOURCE_READY', action.payload);
      const { group, resource } = parseResourceString(action.payload);
      let resourcesReadyIncrement = 0;

      const newState = produce(state.resourceStates, draft => {
        // If the group doesn't exist, add it
        draft[group] ||= {};

        // If the resource doesn't exist, add it
        if (!draft[group][resource]) {
          draft[group][resource] = {
            initialized: false,
            error: false,
            message: '',
          };
        }

        // Check if the resource is already marked as ready
        if (!draft[group][resource].initialized) {
          draft[group][resource].initialized = true;
          draft[group][resource].error = false;
          draft[group][resource].message = '';
          // Increment only if the state has changed
          resourcesReadyIncrement = 1;
        }
      });

      return {
        ...state,
        resourceStates: newState,
        resourcesReady: state.resourcesReady + resourcesReadyIncrement,
      };
    }

    case 'MARK_RESOURCE_ERROR': {
      console.log('MARK_RESOURCE_ERROR', action.payload);
      const { group, resource } = parseResourceString(action.payload);

      const newState = produce(state.resourceStates, draft => {
        // If the group doesn't exist, add it
        draft[group] ||= {};

        // If the resource doesn't exist, add it
        if (!draft[group][resource]) {
          draft[group][resource] = {
            initialized: false,
            error: false,
            message: '',
          };
        }

        if (!draft[group][resource].error || draft[group][resource].message !== '') {
          draft[group][resource].error = true;
          draft[group][resource].message = '';
        }
      });

      return {
        ...state,
        resourceStates: newState,
      };
    }

    case 'SET_RESOURCES': {
      console.log('SET_RESOURCES', action.payload);

      const newState = produce(state.resourceStates, draft => {
        for (const resourceString in action.payload.resources) {
          const { group, resource } = parseResourceString(resourceString);

          draft[group] ||= {};

          if (!draft[group][resource]) {
            // Initialize if the resource does not exist yet
            draft[group][resource] = {
              initialized: false, // Or true, based on your logic needs
              error: false,
              message: '',
            };
          }
        }
      });

      return {
        ...state,
        resourceStates: newState,
        totalResources: calculateTotalResources(newState),
      };
    }
  }
}

type GroupVersionResource = {
  group: string;
  version: string;
  resource: string;
};

function parseResourceString(input: string): GroupVersionResource {
  const parts = input.split(', Resource=');
  if (parts.length !== 2) {
    throw new Error('Invalid input format');
  }

  let [groupVersion, resource] = parts;
  let [group, version] = groupVersion.split('/');
  group = group.trim();
  resource = resource.trim();

  // Use 'core' as the default group if empty
  if (group === '') {
    group = 'core';
  }

  const gvr: GroupVersionResource = {
    group,
    version,
    resource,
  };

  return gvr;
}

const Connecting: FC = () => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const reduxDispatch = useDispatch();
  const { navigate, contextID } = usePluginRouter();

  const handleInitialized = () => {
    // Replace the current location with the new one instead of pushing a new one
    navigate('/explorer/pods', { replace: true, withinContext: true });
  };

  const handleCancel = () => {
    // Navigate to plugin home and remove the tab
    navigate('/', { replace: true });
    reduxDispatch(handleRemoveTab(contextID));
  };

  useEffect(() => {
    if (!contextID) {
      return;
    }

    const ReadyEvent = `${contextID}::RESOURCE::READY`;
    const ErrorEvent = `${contextID}::RESOURCE::ERROR`;
    const AllReadyEvent = `${contextID}::RESOURCE::ALL_READY`;

    // Go is much faster here, so we may actually receive the event before we're done setting up the listeners
    // so we need to make sure we're listening before we start the switch context
    const readyCloser = EventsOn(ReadyEvent, (resource: string) => {
      dispatch({ type: 'MARK_RESOURCE_READY', payload: resource });
    });
    const errorCloser = EventsOn(ErrorEvent, (resource: string) => {
      dispatch({ type: 'MARK_RESOURCE_ERROR', payload: resource });
    });
    const allReadyCloser = EventsOn(AllReadyEvent, () => {
      handleInitialized();
    });
    //
    // StartContext(contextID).then(resources => {
    //   // Resources is a map of gvr strings to booleans, split and convert to the expected format
    //   dispatch({ type: 'SET_RESOURCES', payload: { resources } });
    // }).catch(err => {
    //   console.error('Error switching context:', err);
    //   // Unsubscribe
    //   EventsOff(ReadyEvent);
    //   EventsOff(ErrorEvent);
    //   EventsOff(AllReadyEvent);
    // });
    //
    return () => {
      // Unsubscribe
      readyCloser()
      errorCloser()
      allReadyCloser()
    };
  }, []);

  return (
    <Stack direction='column' width={'100%'} maxHeight={'100%'} p={4} gap={4} justifyContent={'flex-start'}>
      <Stack direction='row' gap={1} alignItems='center'>
        <Heading level={4}>Connecting To Cluster</Heading>
        {Math.floor((state.resourcesReady / state.totalResources) * 100) === 100 && <CheckCircle color='success' sx={{ height: '20px' }} />}
      </Stack>
      <LinearProgress variant='determinate' value={Math.floor((state.resourcesReady / state.totalResources) * 100)} />

      <Stack direction='row' justifyContent='flex-start' gap={2} flexWrap='wrap'>
        {Object.keys(state.resourceStates).map(group => (
          <Box
            key={group}
            sx={{
              width: 320,
              maxHeight: 300,
              // Don't grow vertically
              flex: '0 0 auto',
              overflow: 'auto',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <List sx={{
              '--ListItem-minHeight': '1.2rem',
            }}>
              <ListItem nested key={group}>
                <ListSubheader sticky>{group}</ListSubheader>
                <List>
                  {Object.keys(state.resourceStates[group]).map(resource => {
                    const curr = state.resourceStates[group][resource];
                    return (
                      <ListItem key={resource}>
                        <Stack direction='row' gap={1} alignItems='center' key={resource}>
                          <Text size='xs'>{resource}</Text>
                          {curr.initialized && <CheckCircle color='success' sx={{ height: '14px' }} />}
                          {curr.error
                            && <>
                              <ErrorIcon color='error' sx={{ height: '14px' }} />
                              <Text size='xs' sx={{ color: 'error.main' }}>{curr.message}</Text>
                            </>
                          }
                          {!curr.initialized && !curr.error && <CircularProgress
                            size={14}
                            sx={{
                              thickness: 2,
                            }}
                          />}
                        </Stack>
                      </ListItem>
                    );
                  })}
                </List>
              </ListItem>
            </List>
          </Box>
        ))}
      </Stack>
      <Box
        sx={{
          gridColumn: '1/-1',
          justifySelf: 'flex-start',
          display: 'flex',
          gap: 1,
        }}
      >
        <Button emphasis='outline' color='neutral' size='sm' onClick={handleCancel}>
          Cancel
        </Button>
      </Box>
    </Stack>
  );
};

Connecting.displayName = 'ConnectingPage';

export default Connecting;
