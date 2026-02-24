import React from "react";

// project-imports
import { KubernetesResourceObject } from "../../../../../types/resource";
import CodeEditor from "../../../CodeEditor";
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
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
    <Stack sx={{ flex: 1 }} gap={1} direction='column'>
      <CodeEditor
        diff={usingDiff}
        original={stringify(data)}
        value={value}
        onChange={onChange}
        language="yaml"
        filename={filename}
      />
      <Stack direction='row' justifyContent='space-between'>
        <Button
          size='sm'
          emphasis='soft'
          color='neutral'
          startAdornment={<LuFileCode />}
          onClick={toggleDiff}
        >
          {usingDiff ? "Show Editor" : "Show Diff"}
        </Button>

        <Stack direction='row' gap={0.5}>
          <Button
            startAdornment={<LuX />}
            color='neutral'
            disabled={!changed}
            size='sm'
            emphasis='soft'
            onClick={resetValue}
          >
            Reset
          </Button>
          <Button
            startAdornment={<LuSave />}
            color='primary'
            disabled={!changed}
            size='sm'
            emphasis='soft'
            onClick={handleSubmit}
          >
            Submit
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
};

BaseEditorPage.displayName = "BaseEditorPage";
export default BaseEditorPage;
