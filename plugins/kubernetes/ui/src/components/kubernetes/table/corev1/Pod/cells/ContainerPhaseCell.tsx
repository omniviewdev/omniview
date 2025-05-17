import React, { ComponentProps } from "react"
import { Typography } from "@mui/joy"

const colorMap: Record<string, ComponentProps<typeof Typography>['color']> = {
  "Active": "success",
  "Pending": "warning",
  "Running": "success",
  "Succeeded": "success",
  "Failed": "danger",
  "Unknown": "warning",
  "Terminating": "neutral",
  "Terminated": "danger",
}


type Props = {
  value: string | undefined
}

const ContainerPhaseCell: React.FC<Props> = ({ value }) => {
  if (!value || !colorMap[value]) {
    return <></>
  }
  return (
    <Typography color={colorMap[value]}>{value}</Typography>
  )
}

export default ContainerPhaseCell
