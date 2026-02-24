import { Chip } from "@omniviewdev/ui"
import { Stack } from "@omniviewdev/ui/layout"

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
      {values.map((value) => <Chip size={'sm'} sx={{ borderRadius: '2px' }} emphasis='outline' label={value} />)}
    </Stack>
  )
}

export default ChipList
