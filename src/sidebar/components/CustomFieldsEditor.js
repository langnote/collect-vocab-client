import { useRef, useState } from 'preact/hooks';
import MarkdownEditor from './MarkdownEditor';

const customFieldsSchema = {
  type: 'object',
  properties: {
    custom_fields: {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          properties: {
            type: {
              title: 'Vocabulary',
              enum: ['vocab'],
              options: {
                hidden: true,
              },
            },
            context: {
              title: 'Context',
              description: 'The sentence from which the text is quoted.',
              type: 'string',
            },
            cambridge_definition: {
              title: 'Cambridge definition',
              description: 'Definition quoted from Cambridge dictionary.',
              type: 'string',
            },
            cambridge_definition_id: {
              type: 'string',
              options: {
                hidden: true,
              },
            },
            cambridge_definition_url: {
              type: 'string',
              options: {
                hidden: true,
              },
            },
            oxford_definition: {
              title: 'Oxford definition',
              description: 'Definition quoted from Oxford dictionary.',
              type: 'string',
            },
            oxford_definition_id: {
              type: 'string',
              options: {
                hidden: true,
              },
            },
            oxford_definition_url: {
              type: 'string',
              options: {
                hidden: true,
              },
            },
          },
          options: {
            id: 'b1b10dc8-0e4b-4b56-9c95-4ea229eb0fd4',
            deleted: false,
          },
          required: ['type'],
        },
        {
          type: 'object',
          properties: {
            type: {
              title: 'Mistake',
              enum: ['mistake'],
              options: {
                hidden: true,
              },
            },
            context: {
              title: 'Context',
              description: 'The sentence from which the text is quoted.',
              type: 'string',
            },
            explanation: {
              title: 'Explanation',
              description: 'Explanation.',
              type: 'string',
            },
            correction: {
              title: 'Correction',
              description: 'Correction.',
              type: 'string',
            },
          },
          options: {
            id: 'b1b10dc8-0e4b-4b56-9c95-4ea229eb0fd3',
            deleted: false,
          },
          required: ['type'],
        },
        {
          type: 'object',
          properties: {
            type: {
              title: 'Grammar',
              enum: ['grammar'],
              options: {
                hidden: true,
              },
            },
            context: {
              title: 'Context',
              description: 'The sentence from which the text is quoted.',
              type: 'string',
            },
            pattern: {
              title: 'Pattern',
              description: 'Pattern.',
              type: 'string',
            },
          },
          options: {
            id: 'b1b10dc8-0e4b-4b56-9c95-4ea229eb0fd2',
            deleted: false,
          },
          required: ['type'],
        },
      ],
    },
  },
};

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

  const schemaTypes = [];
  const schemaHashTable = {};
  const selectedType = useRef('');
  for (const schema of customFieldsSchema.properties.custom_fields.oneOf) {
    if (Object.prototype.hasOwnProperty.call(schema.properties, 'type')) {
      schemaTypes.push({
        name: schema.properties.type.title,
        value: schema.properties.type.enum[0],
      });
      // @ts-ignore
      schemaHashTable[schema.properties.type.enum[0]] = schema;
    }
  }

  // @ts-ignore
  const handleOptionChange = changeEvent => {
    selectedType.current = changeEvent.target.value;
    // @ts-ignore
    setSelectedSchema(schemaHashTable[changeEvent.target.value]);
  };

  return (
    <div>
      <div>
        {schemaTypes.map(type => (
          <label
            htmlFor={`inlineRadio-${annotationId}-${type.value}`}
            className="inline-flex items-center mb-2 mr-2"
            key={type.value}
          >
            <input
              className="appearance-none rounded-full h-4 w-4 border border-gray-300 bg-white checked:bg-lime-500 checked:border-lime-500 align-top bg-no-repeat bg-center bg-contain float-left mr-1"
              type="radio"
              name="inlineRadioOptions"
              id={`inlineRadio-${annotationId}-${type.value}`}
              value={type.value}
              onChange={handleOptionChange}
              checked={selectedType.current === type.value}
            />
            <span>{type.name}</span>
          </label>
        ))}
        <label
          htmlFor="inlineRadio300"
          className="inline-flex items-center mb-2 mr-2 opacity-50"
        >
          <input
            className="appearance-none rounded-full h-4 w-4 border border-gray-300 bg-white checked:bg-blue-600 checked:border-blue-600 focus:outline-none transition duration-200 align-top bg-no-repeat bg-center bg-contain float-left mr-1"
            type="radio"
            name="inlineRadioOptions"
            id="inlineRadio300"
            value="option3"
            disabled
          />
          <span>3 (disabled)</span>
        </label>
      </div>
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
