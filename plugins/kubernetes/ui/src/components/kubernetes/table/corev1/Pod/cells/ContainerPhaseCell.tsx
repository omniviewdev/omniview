import React from "react"
import { Text } from "@omniviewdev/ui/typography"

const colorMap: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
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
    <Text color={colorMap[value]}>{value}</Text>
  )
}

export default ContainerPhaseCell
