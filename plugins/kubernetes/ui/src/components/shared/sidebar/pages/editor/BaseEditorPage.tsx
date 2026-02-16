import React from "react";

// project-imports
import { KubernetesResourceObject } from "../../../../../types/resource";
import CodeEditor from "../../../CodeEditor";
import { Button, ButtonGroup, Stack } from "@mui/joy";
import { stringify, parse } from 'yaml'
import { LuFileCode, LuSave, LuX } from "react-icons/lu";

interface Props {
  kind?: string;
  data?: KubernetesResourceObject;
  children?: React.ReactNode;
  onSubmit?: (value: Record<string, any>) => void;
}

/**
 * Displays the baseline editor for the monaco editor
 */
export const BaseEditorPage: React.FC<Props> = ({ data, kind, onSubmit }) => {
  const [value, setValue] = React.useState<string>(stringify(data))
  const [usingDiff, setUsingDiff] = React.useState<boolean>(false)
  const [changed, setChanged] = React.useState<boolean>(false)

  const filename = kind ? `${kind}/${data?.metadata?.uid}/spec.yaml` : `${data?.metadata?.uid}/spec.yaml`

  const onChange = (value: string) => {
    if (!changed) {
      setChanged(true)
    }
    setValue(value)
  }

  const handleSubmit = () => {
    if (onSubmit) {
      const val = parse(value)
      onSubmit(val)
    }
  }

  /**
   * Make sure we update whenever the input data changes
   */
  React.useEffect(() => {
    setValue(stringify(data))
  }, [data])

  const toggleDiff = () => setUsingDiff(prev => !prev)

  const resetValue = () => {
    setChanged(false)
    setValue(stringify(data))
  }

  if (!data) {
    console.log("did not get any data")
    return <React.Fragment />;
  }

  // compose your component here
  return (
    <Stack flex={1} gap={1} direction={'column'}>
      <CodeEditor
        diff={usingDiff}
        original={stringify(data)}
        value={value}
        onChange={onChange}
        language="yaml"
        filename={filename}
      />
      <Stack direction={'row'} justifyContent={'space-between'}>
        <Button
          size={'sm'}
          variant={'soft'}
          color={'neutral'}
          startDecorator={<LuFileCode />}
          onClick={toggleDiff}
        >
          {usingDiff ? "Show Editor" : "Show Diff"}
        </Button>

        <Stack direction={'row'}>
          <ButtonGroup variant={'soft'} size={'sm'}>
            <Button
              startDecorator={<LuX />}
              color={"neutral"}
              disabled={!changed}
              size={'sm'}
              onClick={resetValue}
            >
              Reset
            </Button>
            <Button
              startDecorator={<LuSave />}
              color={'primary'}
              disabled={!changed}
              size={'sm'}
              onClick={handleSubmit}
            >
              Submit
            </Button>
          </ButtonGroup>
        </Stack>
      </Stack>
    </Stack>
  );
};

BaseEditorPage.displayName = "BaseEditorPage";
export default BaseEditorPage;
