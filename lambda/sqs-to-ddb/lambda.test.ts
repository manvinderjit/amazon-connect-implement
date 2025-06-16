process.env.TABLE_NAME = "test-table";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SQSEvent, SQSRecord } from "aws-lambda";
import { handler } from "./index.js";

// Setup mock
const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

test("processes a valid message and inserts into DynamoDB", async () => {
  ddbMock.on(PutCommand).resolves({});

  const event: SQSEvent = {
    Records: [
      {
        messageId: "1",
        body: JSON.stringify({
          phoneNumber: "9876543210",
          targetNumber: "9876543210",
          timestamp: "2024-01-01T00:00:00Z",
          vanityNumbers: {
            first: "987-ABC-ABCD",
            second: "987-DEF-ABCD",
            third: "987-GHI-ABCD",
            fourth: "987-JKL-ABCD",
            fifth: "987-MNO-ABCD",
          },
        }),
        attributes: {} as any,
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "us-east-1",
        receiptHandle: "",
      } as SQSRecord,
    ],
  };

  await handler(event, {} as any, () => {});

  expect(ddbMock.calls()).toHaveLength(1);
  expect(ddbMock.commandCalls(PutCommand)[0].args[0].input).toMatchObject({
    TableName: "test-table",
    Item: expect.objectContaining({
      callerNumber: "9876543210",
    }),
  });
});

test("throws error for invalid message schema", async () => {
  const invalidMessage = {
    phoneNumber: "",
    targetNumber: "123",
    timestamp: "now",
    vanityNumbers: {},
  };

  const event: SQSEvent = {
    Records: [
      {
        messageId: "2",
        body: JSON.stringify(invalidMessage),
        attributes: {} as any,
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: "us-east-1",
        receiptHandle: "",
      } as SQSRecord,
    ],
  };

  await expect(handler(event, {} as any, () => {})).resolves.toBeUndefined();

  // Ensure no call made to DynamoDB
  expect(ddbMock.calls()).toHaveLength(0);
});
