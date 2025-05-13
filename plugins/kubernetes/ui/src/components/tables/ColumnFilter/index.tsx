import React from 'react';
// material-ui
import { ClickAwayListener } from '@mui/base';
import { Unstable_Popup as BasePopup } from '@mui/base/Unstable_Popup';
import {
  Card,
  CardContent,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemContent,
  Grid,
  IconButton,
  Switch,
  Typography,
  styled,
  ListDivider
} from '@mui/joy';

// icons
import { type Column } from '@tanstack/react-table';
import { LuColumns2, LuSettings2, LuStickyNote, LuTag } from 'react-icons/lu';

const PopupBody = styled('div')(
  ({ theme }) => `
  width: max-content;
  border-radius: 8px;
  border: 1px solid ${theme.palette.divider};
  background-color: ${theme.palette.background.popup};
  box-shadow: ${theme.palette.mode === 'dark'
      ? '0px 4px 8px rgb(0 0 0 / 0.7)'
      : '0px 4px 8px rgb(0 0 0 / 0.1)'
    };
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 0.875rem;
  z-index: 1;
`,
);

type Props = {
  labels: Record<string, boolean>;
  setLabels: (vals: Record<string, boolean>) => void;
  annotations: Record<string, boolean>
  setAnnotations: (vals: Record<string, boolean>) => void;
  anchorEl: HTMLElement | undefined;
  columns: Array<Column<any>>;
  onClose: () => void;
  onClick: React.MouseEventHandler<HTMLAnchorElement>;
};

const ColumnFilter: React.FC<Props> = ({
  labels,
  setLabels,
  annotations,
  setAnnotations,
  anchorEl,
  columns,
  onClose,
  onClick
}) => {
  const open = Boolean(anchorEl);

  const labelList = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
  const annotationList = Object.entries(annotations).sort(([a], [b]) => a.localeCompare(b))

  const setLabel = (id: string, value: boolean) => {
    setLabels({ [id]: value })
  }

  const setAnnotation = (id: string, value: boolean) => {
    setAnnotations({ [id]: value })
  }

  return (
    <React.Fragment>
      <IconButton
        variant='outlined'
        color='neutral'
        onClick={onClick}
        sx={{
          "--IconButton-size": "32px"
        }}
      >
        <LuSettings2 size={20} />
      </IconButton>
      <BasePopup
        style={{
          zIndex: 1000,
          maxHeight: '50vh',
        }}
        id={'table-filter-menu'}
        open={open}
        anchor={anchorEl}
        placement='bottom-end'
      >
        <ClickAwayListener
          onClickAway={() => {
            onClose();
          }}
        >
          <PopupBody>
            <Card
              variant="outlined"
              sx={{
                bgcolor: '#131315',
                maxWidth: '100%',
                minWidth: '300px',
                maxHeight: '50vh',
                p: 0,
                gap: 0,
              }}
            >
              <Typography
                startDecorator={<LuColumns2 size={14} />}
                level='title-sm'
                p={1}
              >
                Columns
              </Typography>
              <Divider />
              <CardContent
                sx={{
                  p: 0,
                  overflow: 'hidden',
                }}
              >
                <Grid
                  container
                  sx={{
                    '--Grid-borderWidth': '1px',
                    '& > div': {
                      minWidth: '200px',
                    },
                    flexWrap: 'nowrap',
                    overflow: 'hidden',
                  }}
                >
                  <Grid
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1.5,
                      p: 1,
                      overflow: 'auto',
                    }}
                  >
                    {columns.filter(col => col.getCanHide()).map((column) => (
                      <Typography
                        key={column.columnDef.id}
                        startDecorator={
                          <Switch
                            sx={{ color: 'primary', mr: 1 }}
                            size='sm'
                            checked={column.getIsVisible()}
                            onChange={column.getToggleVisibilityHandler()}
                          />
                        }
                        component='label'
                        level='body-xs'
                      >
                        {column.columnDef.header?.toString()}
                      </Typography>
                    ))}
                  </Grid>
                  <Divider orientation='vertical' />
                  <Grid
                    sx={{
                      minWidth: '400px',
                      overflow: 'auto',
                    }}
                  >
                    <Typography p={1} startDecorator={<LuTag size={14} />} level='title-sm'>Labels</Typography>
                    <Divider />
                    <List
                      size='sm'
                      sx={{
                        '--ListItem-minHeight': '28px',
                        "--ListDivider-gap": "0px"
                      }}
                    >
                      {labelList.map(([label, selected], idx) => (
                        <React.Fragment key={label}>
                          <ListItem key={label} sx={{ maxHeight: '28px' }}>
                            <ListItemButton
                              selected={selected}
                              sx={{
                                maxHeight: '28px',
                                '&:hover': {
                                  bgcolor: 'neutral.700'
                                }
                              }}
                              onClick={() => setLabel(label, !selected)}
                            >
                              <ListItemContent>
                                <Typography level='body-xs'>{label}</Typography>
                              </ListItemContent>
                            </ListItemButton>
                          </ListItem>
                          {idx !== labelList.length - 1 && <ListDivider />}
                        </React.Fragment>
                      ))}
                    </List>
                    {/* TODO: Add label column selection creation  */}
                  </Grid>
                  <Divider orientation='vertical' />
                  <Grid
                    sx={{
                      minWidth: '400px',
                      overflow: 'auto',
                    }}
                  >
                    <Typography p={1} startDecorator={<LuStickyNote size={14} />} level='title-sm'>Annotations</Typography>
                    <Divider />
                    <List
                      size='sm'
                      sx={{
                        '--ListItem-minHeight': '28px',
                        "--ListDivider-gap": "0px"
                      }}
                    >
                      {annotationList.map(([annotation, selected], idx) => (
                        <React.Fragment key={annotation}>
                          <ListItem key={annotation} sx={{ maxHeight: '28px' }}>
                            <ListItemButton
                              selected={selected}
                              sx={{
                                maxHeight: '28px',
                                '&:hover': {
                                  bgcolor: 'neutral.700'
                                }
                              }}
                              onClick={() => setAnnotation(annotation, !selected)}
                            >
                              <ListItemContent>
                                <Typography level='body-xs'>{annotation}</Typography>
                              </ListItemContent>
                            </ListItemButton>
                          </ListItem>
                          {idx !== annotationList.length - 1 && <ListDivider />}
                        </React.Fragment>
                      ))}
                    </List>
                    {/* TODO: Add annotation column selection creation  */}
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </PopupBody>
        </ClickAwayListener>
      </BasePopup>
    </React.Fragment>
  );
};

ColumnFilter.displayName = 'ColumnFilter';
ColumnFilter.whyDidYouRender = true;

export default ColumnFilter;

