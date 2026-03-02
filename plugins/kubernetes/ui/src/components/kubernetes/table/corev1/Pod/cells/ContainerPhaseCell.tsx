import React from "react"
import { Text } from "@omniviewdev/ui/typography"

const colorMap: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  "Active": "success",
  "Pending": "info",
  "Running": "success",
  "Succeeded": "success",
  "Failed": "danger",
  "Unknown": "info",
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
