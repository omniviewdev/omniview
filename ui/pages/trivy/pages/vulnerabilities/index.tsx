import React from 'react';

import Box from '@mui/material/Box';
import { Button } from '@omniviewdev/ui/buttons';
import { Link } from '@omniviewdev/ui/typography';
import { Text, Heading } from '@omniviewdev/ui/typography';
import { Stack } from '@omniviewdev/ui/layout';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getExpandedRowModel,
  flexRender,
  getSortedRowModel,
  type ColumnFiltersState,
  type VisibilityState,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFacetedMinMaxValues,
} from '@tanstack/react-table';
import { LuChartArea, LuFileText } from 'react-icons/lu';

import { TrivyReport } from '../../parser';
import { columns } from './VulnerabilityReportColumns';
import Row from './VulnerabilityReportRow';
import ReportInfoHeader from './VulnerabilityReportHeader';
import mockData from './mock.json';
import { DebouncedInput } from '@/components/tables/Resources/DebouncedInput';
import FilterDisplay from '../../table/FilterDisplay';

const TrivyVulnerabilitiesPage = () => {
  const report = new TrivyReport(mockData);

  const data = React.useMemo(() => report.getAllVulnerabilities(), []);
  const parentRef = React.useRef<HTMLDivElement>(null);

  const [search, setSearch] = React.useState<string>('');
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});

  const table = useReactTable({
    data,
    columns,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setSearch,
    state: {
      columnFilters,
      columnVisibility,
      globalFilter: search,
    },
    initialState: {
      sorting: [{ id: 'Severity', desc: true }],
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getFacetedRowModel: getFacetedRowModel(), // client-side faceting
    getFacetedUniqueValues: getFacetedUniqueValues(), // generate unique values for select filter/autocomplete
    getFacetedMinMaxValues: getFacetedMinMaxValues(), // generate min/max values for range filter
    debugTable: true,
    defaultColumn: {
      minSize: 0,
      size: Number.MAX_SAFE_INTEGER,
      maxSize: Number.MAX_SAFE_INTEGER,
    },
  });

  return (
    <Stack
      sx={{
        overflow: 'auto',
        maxHeight: '100%',
      }}
      spacing={1}
      p={1}
    >
      <Stack direction='row' gap={1.5} alignItems='center' justifyContent={'space-between'}>
        <Stack direction='row' gap={1} alignItems='center'>
          <LuChartArea />
          <Heading level={4}>{'Vulnerability Report'}</Heading>
        </Stack>
        <Stack direction='row' gap={1.5} alignItems='center'>
          <Button emphasis='soft' startAdornment={<LuFileText />} color='primary'>{'Generate Report'}</Button>
          <DebouncedInput
            value={search ?? ''}
            onChange={value => {
              setSearch(String(value));
            }}
            placeholder={'Search vulnerabilities'}
          />
        </Stack>
      </Stack>
      <ReportInfoHeader report={report} />
      <Stack
        direction='row'
        gap={1}
        display='flex'
        alignItems='flex-start'
      >
        <Stack direction='column'>
          <FilterDisplay columns={table.getAllColumns()} />
        </Stack>
        <Box
          ref={parentRef}
          sx={{
            width: '100%',
            display: 'flex',
            borderRadius: '4px',
            flex: 1,
            overflow: 'scroll',
            minHeight: 0,
            border: '1px solid',
            borderColor: 'divider',
            '&::-webkit-scrollbar': {
              display: 'none',
            },
            scrollbarWidth: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          <table
            aria-label="collapsible table"
            style={{ width: '100%', borderCollapse: 'collapse' }}
          >
            <thead
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 1,
              }}
            >
              {table.getHeaderGroups().map(headerGroup => (
                <tr
                  key={headerGroup.id}
                  style={{ display: 'flex', width: '100%', cursor: 'pointer' }}
                >
                  {headerGroup.headers.map(header => (
                    <th
                      key={header.id}
                      style={{
                        alignContent: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        width: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                        maxWidth: header.getSize() === Number.MAX_SAFE_INTEGER ? 'auto' : header.getSize(),
                        flex: 1,
                      }}
                    >
                      {header.column.getCanSort()
                        ? <Link
                            component='button'
                            onClick={header.column.getToggleSortingHandler()}
                            sx={{
                              fontWeight: 'bold',
                              display: 'flex',
                              alignItems: 'center',
                              '& svg': {
                                transition: '0.2s',
                                transform:
                                  header.column.getIsSorted() as string === 'desc' ? 'rotate(180deg)' : 'rotate(0deg)',
                              },
                            }}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getIsSorted() && <ArrowDropDownIcon />}
                          </Link>
                        : flexRender(header.column.columnDef.header, header.getContext())
                      }
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map(row => <Row key={row.id} row={row} />)}
            </tbody>
          </table>
        </Box>
      </Stack>
    </Stack>
  );

};

export default TrivyVulnerabilitiesPage;
