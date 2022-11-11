import { useRef } from 'preact/hooks';

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

/**
 * @typedef CustomFieldsSchemaSelectorProps
 * @prop {string} [annotationId]
 * @prop {(selectedType: string, selectedSchema: object) => void} [onSelectSchemaType]
 */

/**
 * Radio buttons to choose schema for custom fields.
 *
 * @param {CustomFieldsSchemaSelectorProps} props
 */
export default function CustomFieldsSchemaSelector({
  annotationId = '',
  onSelectSchemaType = () => {},
}) {
  const selectedType = useRef('');
  const schemaTypes = [];
  const schemaHashTable = {};

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
    onSelectSchemaType(
      changeEvent.target.value,
      // @ts-ignore
      schemaHashTable[changeEvent.target.value]
    );
  };

  return (
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
            name={`inlineRadioOptions-${annotationId}`}
            id={`inlineRadio-${annotationId}-${type.value}`}
            value={type.value}
            onChange={handleOptionChange}
            checked={selectedType.current === type.value}
          />
          <span>{type.name}</span>
        </label>
      ))}
    </div>
  );
}
