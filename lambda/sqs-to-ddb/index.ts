import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { SQSEvent, SQSRecord, Context, Callback, Handler } from "aws-lambda";

const messageSchema = z.object({
  phoneNumber: z.string().min(1),
  timestamp: z.string().min(1),
  targetNumber: z.string().min(1),
  vanityNumbers: z.object({
    first: z.string(),
    second: z.string(),
    third: z.string(),
  }),
});

type MessageBody = z.infer<typeof messageSchema>;

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);
const tableName = process.env.TABLE_NAME;

async function processMessageAsync(message: SQSRecord): Promise<void> {
  let insertID = "";

  try {
    const data = JSON.parse(message.body);
    data.vanityNumbers = JSON.parse(data.vanityNumbers);
    const validatedData = messageSchema.parse(data);

    insertID = `${validatedData.phoneNumber}-${validatedData.timestamp}`;

    await dynamo.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          id: insertID,
          callerNumber: validatedData.phoneNumber,
          cellNumber: validatedData.targetNumber,
          timestamp: validatedData.timestamp,
          vanityNumbers: validatedData.vanityNumbers,
        },
        ConditionExpression: "attribute_not_exists(id)",
      })
    );
  } catch (err: any) {
    if (err.name === "ConditionalCheckFailedException") {
      console.warn("Item already exists, skipping insert:", insertID);
      return;
    } else if (err instanceof z.ZodError) {
      console.error("Validation failed:", err.errors);
      throw err;
    } else {
      console.error("Failed to process message:", {
        errorMessage: err.message,
        stack: err.stack,
        messageBody: message.body,
      });
      throw err;
    }
  }
}

export const handler: Handler<SQSEvent, void> = async (
  event: SQSEvent,
  context: Context,
  callback: Callback
): Promise<void> => {
  for (const message of event.Records) {
    try {
      await processMessageAsync(message);
    } catch (err: any) {
      console.error("Error processing individual message", {
        messageId: message.messageId,
        body: message.body,
        error: err.message,
      });
      // Optional: Send to DLQ or alert
    }
  }
};