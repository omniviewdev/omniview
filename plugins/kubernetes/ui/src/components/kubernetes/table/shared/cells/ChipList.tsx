import { Chip, Stack } from "@mui/joy"

type Props = {
  values: string[]
}

export const ChipListCell = ({ getValue }: { getValue: () => unknown }) => {
  const val = getValue() as string[] | undefined
  if (!val) {
    return <></>
  }

  return <ChipList values={val} />
}

const ChipList: React.FC<Props> = ({ values }) => {
  return (
    <Stack
      direction={'row'}
      overflow={'scroll'}
      gap={0.25}
      sx={{
        scrollbarWidth: "none",
        // hide scrollbar
        "&::-webkit-scrollbar": {
          display: "none",
        },
      }}>
      {values.map((value) => <Chip size={'sm'} sx={{ borderRadius: '2px' }} variant='outlined'>{value}</Chip>)}
    </Stack>
  )
}

export default ChipList
