import * as React from 'react';

import { Banner, Button, Dialog, Menu, Spinner, Stack, Text } from '@omniviewdev/base-ui';

// icons
import { LuCircleAlert, LuTrash, LuTriangleAlert } from 'react-icons/lu';
import { parseAppError, useResourceMutations, type AccessRoute, type ResourceReference } from '@omniviewdev/runtime';

type Props = {
  plugin: string;
  route: AccessRoute;
  reference: ResourceReference;
  handleSelect: () => void;
  handleDeselect: () => void;
  handleDismiss: () => void;
};

/**
 * "Delete" menu item plus its confirmation dialog. Must be rendered inside a `Menu.Popup`;
 * the parent menu should keep its popup mounted so the dialog survives the menu closing.
 */
export const DeleteAction: React.FC<Props> = ({ reference, plugin, route, handleSelect, handleDeselect, handleDismiss }) => {
  const [open, setOpen] = React.useState<boolean>(false);
  const [pending, setPending] = React.useState<boolean>(false);
  const [alert, setAlert] = React.useState<string>('');

  const { mutate } = useResourceMutations({ pluginID: plugin });
  const { id, type: resource } = reference.address;

  return (
    <React.Fragment>
      <Menu.Item
        startDecorator={<LuTrash />}
        onMouseEnter={handleSelect}
        onMouseLeave={handleDeselect}
        onClick={() => {
          setOpen(true);
        }}
      >
        Delete
      </Menu.Item>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        size="sm"
        role="alertdialog"
      >
        <Dialog.Title icon={<LuTriangleAlert />}>Confirmation</Dialog.Title>
        <Dialog.Body>
          <Stack direction="column" spacing={4}>
            <Text size='sm'>
              Are you sure you want to delete {resource} '{id}'?
            </Text>
            {alert && (
              <Banner color="danger" variant="soft">
                <Banner.Icon>
                  <LuCircleAlert />
                </Banner.Icon>
                <Banner.Content>
                  <Banner.Title>Error</Banner.Title>
                  <Text size="sm" tone="danger">
                    {alert}
                  </Text>
                </Banner.Content>
              </Banner>
            )}
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="solid" color="danger" disabled={pending} onClick={() => {
            setPending(true);
            mutate({ route, reference, operation: 'delete', input: { kind: 'null' } }).then(() => {
              setOpen(false);
              handleDismiss();
            }).catch((e: unknown) => {
              setAlert(parseAppError(e).detail);
            }).finally(() => {
              setPending(false);
            });
          }}>
            {pending ? <Spinner size="sm" /> : 'Delete'}
          </Button>
          <Button variant="ghost" color="neutral" onClick={() => {
            setOpen(false);
            handleDismiss();
          }}>
            Cancel
          </Button>
        </Dialog.Footer>
      </Dialog>
    </React.Fragment>
  );
};

export default DeleteAction;
