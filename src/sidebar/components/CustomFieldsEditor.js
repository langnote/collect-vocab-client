import { useCallback, useRef, useState } from 'preact/hooks';
import CustomFieldsSchemaSelector from './CustomFieldsSchemaSelector';
import MarkdownEditor from './MarkdownEditor';

// @ts-ignore
function getVisibleFields(schema) {
  let details;
  const visibleFields = [];
  for (const fieldName in schema.properties) {
    if (Object.prototype.hasOwnProperty.call(schema.properties, fieldName)) {
      details = schema.properties[fieldName];
      if (
        Object.prototype.hasOwnProperty.call(details, 'options') &&
        Object.prototype.hasOwnProperty.call(details.options, 'hidden') &&
        details.options.hidden === true
      ) {
        continue;
      }
      visibleFields.push({
        name: fieldName,
        title: details.title,
        placeHolder: `Add ${details.title}`,
      });
    }
  }
  return visibleFields;
}

/**
 * @typedef CustomFieldsEditorProps
 * @prop {string} [annotationId]
 * @prop {Record<string,string>} [textStyle] -
 *   Additional CSS properties to apply to the input field and rendered preview
 * @prop {object} [customFields] - The object contains markdown texts to edit.
 * @prop {(field_name: string, value: string) => void} [onEditCustomFields]
 *   - Callback invoked with `{ text }` object when user edits text.
 *   TODO: Simplify this callback to take just a string rather than an object once the
 *   parent component is converted to Preact.
 */

/**
 * Viewer/editor for the body of an annotation in markdown format.
 *
 * @param {CustomFieldsEditorProps} props
 */
export default function CustomFieldsEditor({
  annotationId = '',
  onEditCustomFields = () => {},
  customFields = {},
  textStyle = {},
}) {
  const [selectedSchema, setSelectedSchema] = useState({});

  const selectedType = useRef('');

  const onSelectSchemaType = useCallback(
    /**
     * @param {string} selected_type
     * @param {object} selected_schema
     */
    (selected_type, selected_schema) => {
      selectedType.current = selected_type;
      setSelectedSchema(selected_schema);
    },
    []
  );

  return (
    <div>
      <CustomFieldsSchemaSelector
        key={`${annotationId}_schema_select`}
        annotationId={annotationId}
        onSelectSchemaType={onSelectSchemaType}
      />
      {getVisibleFields(selectedSchema).map((field, index) => (
        <MarkdownEditor
          key={`${annotationId}_${field.name}_${selectedType.current}`}
          textStyle={textStyle}
          label={field.title}
          // @ts-ignore
          text={customFields[field.name] ?? null}
          onEditText={onEditCustomFields}
          fieldName={field.name}
          placeHolder={field.placeHolder}
          focusOnInit={index === 0}
        />
      ))}
    </div>
  );
}
