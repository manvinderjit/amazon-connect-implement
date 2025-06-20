import fs from "fs";
import path from "path";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const client = new SQSClient({});
const sqslQueueURL = process.env["SQS_QUEUE_URL_VANITY_URL"];

interface DigitToLetters {
  [key: number]: string[];
}

// Define the event and response types
interface Event {
  Details: {
    ContactData: {
      CustomerEndpoint: {
        Address: string;
      };
      Attributes: {
        TargetNumber: string;
      };
    };
  };
}

interface Response {
  ssmlResponse: string;
  ssmlError: string;
}

// Phone keypad mapping
const digitToLetters: DigitToLetters = {
  2: ["A", "B", "C"],
  3: ["D", "E", "F"],
  4: ["G", "H", "I"],
  5: ["J", "K", "L"],
  6: ["M", "N", "O"],
  7: ["P", "Q", "R", "S"],
  8: ["T", "U", "V"],
  9: ["W", "X", "Y", "Z"],
  0: ["0"],
  1: ["1"],
};

let wordSet: Set<string> | undefined;

// Load the wordlist from the json file
const loadWordSet = async (): Promise<Set<string>> => {
  if (!wordSet) {
    try {
      // Read the word list file
      const fileContent = await fs.promises.readFile(
        path.resolve("./wordset.json"),
        "utf8"
      );

      // Parse the JSON content to get the array
      const wordArray: string[] = JSON.parse(fileContent);

      // Ensure each word is trimmed, uppercase, and added to the Set
      wordSet = new Set(
        wordArray
          .map((word) => word.trim().toUpperCase()) // Normalize each word
          .filter((word) => word.length > 0) // Filter out empty words
      );
    } catch (error) {
      console.error("Error loading word set:", error);
      throw new Error("Failed to load word list.");
    }
  }
  return wordSet;
};

// Check if a phone number only has 0s and 1s and no other digits
const checkIsBinary = (number: string): boolean => {
  return /^[01]+$/.test(number);
};

// Count Alphabets in Vanity Number
const countAlphabets = (str: string): number => {
  return (str.match(/[A-Za-z]/g) || []).length;
};

// Sort Vanity Numbers based on the number of alphabets in them
const sortedVanityNumbers = (strings: string[]): string[] =>
  strings.sort((a, b) => countAlphabets(b) - countAlphabets(a));

// Find exact letter word matches
const findExactMatches = (
  combinations: string[],
  wordlist: Set<string>
): string[] => {
  return combinations.filter((word) => wordlist.has(word.toUpperCase()));
};

// Cartesian product helper to generate all possible full-length combinations
const cartesian = (arr: string[][]): string[][] => {
  return arr.reduce<string[][]>(
    (a, b) => a.flatMap((d) => b.map((e) => [...d, e])),
    [[]]
  );
};

// Generate all letter combinations from a phone number
const generateAllFullLengthCombinations = (digits: string): string[] => {
  const chars = digits.split("").map((d) => digitToLetters[parseInt(d)] || []);
  return cartesian(chars).map((arr) => arr.join(""));
};

// Generate Zeros and Ones
const replaceZeroAndOne = (number: string): string => {
  const replacedWord = number
    .split("")
    .map((char) => {
      if (char === "0") {
        return "O";
      } else if (char === "1") {
        return "I";
      }
      return char;
    })
    .join("");

  return replacedWord;
};

// TODO: Improve Vanity Number Generation

// Find matches with sliding window that may have a lower word count
const findSlidingMatches = (
  combinations: string[],
  wordlist: Set<string>,
  windowSize: number,
  matches: Set<string> = new Set(),
  number: string
): Set<string> => {
  if (windowSize > 1) {
    for (const word of combinations) {
      for (let start = 0; start <= word.length - windowSize; start++) {
        const prefix = word.slice(0, start) ?? null;
        const subWord = word.slice(start, start + windowSize);
        const suffix = word.slice(start + windowSize) ?? null;

        if (wordlist.has(subWord)) {
          matches.add(
            `${
              prefix && wordlist.has(prefix) ? prefix : number.slice(0, start)              
            }${subWord}${
              suffix && wordlist.has(suffix)
                ? suffix
                : number.slice(start + windowSize)
            }`
          );
        }
        // Replace digit 0 with alphabet O and 1 with alphabet I, if present
        if (/[01]/.test(word)) {
          const replacedWord = replaceZeroAndOne(word);
          const prefixIO = replacedWord.slice(0, start) ?? null;
          const subWordIO = replacedWord.slice(start, start + windowSize);
          const suffixIO = replacedWord.slice(start + windowSize) ?? null;

          if (wordlist.has(subWordIO)) {
            matches.add(
              `${
                prefixIO && wordlist.has(prefixIO)
                  ? prefix
                  : number.slice(0, start)
              }${subWord}${
                suffix && wordlist.has(suffixIO)
                  ? suffix
                  : number.slice(start + windowSize)
              }`
            );
          }
        }
      }
    }    
    return findSlidingMatches(combinations, wordlist, windowSize - 1, matches, number);
  } else {
    return matches;
  }
};

// Generates the alphabets randomly, may not be an actual word
const fallbackRandomLetters = (
  number: string,
  matches: Set<string>
): Set<string> => {
  while (matches.size < 5) {
    const word = number
      .split("")
      .map((d) => {
        const letters = digitToLetters[parseInt(d)] || [d];
        return letters[Math.floor(Math.random() * letters.length)];
      })
      .join("");
    matches.add(word);
  }
  return matches;
};

// Send the data to SQS Queue
const sendNumbersToQueue = async (message: object): Promise<void> => {
  const command = new SendMessageCommand({
    QueueUrl: sqslQueueURL,
    MessageBody: JSON.stringify(message),
  });

  try {
    const data = await client.send(command);
    console.log("Success, message sent. MessageID:", data);
  } catch (err) {
    console.error("Error", err);
    // TODO: Add retries and log error for monitoring
  }
};

// Convert Set to an array and slice the first 5 items and prepend leading digits
const filterFiveResultsAndPrepend = (
  vanityNumbersSet: Set<String>,
  leadingDigits: string
): string[] => {
  
  const setArray = [...vanityNumbersSet];
  
  const result = setArray.slice(0, 5).map((item) => `${leadingDigits}-${item}`);

  return result;
};

// Validate phone number
const isValidPhoneNumber = (phone: string) => {
  if (typeof phone !== "string") return false;

  // Remove + sign if present
  const digitsOnly = phone.startsWith("+") ? phone.slice(1) : phone;

  // Check if it consists of digits only
  if (!/^\d+$/.test(digitsOnly)) return false;

  // Check length (international: 10 to 15 digits is typical)
  const length = digitsOnly.length;
  return length >= 10 && length <= 15;
};

export const handler = async (event: Event): Promise<Response> => {
  try {
    const phoneNumber =
      event.Details.ContactData.CustomerEndpoint.Address;
    const targetNumber = event.Details.ContactData.Attributes.TargetNumber;

    const timestamp = Date.now().toString();

    // Validate phone number and target number
    if (!phoneNumber || !targetNumber || !isValidPhoneNumber(phoneNumber) || !isValidPhoneNumber(targetNumber)) {
      throw new Error("invalidNumber");
    }

    // Keep the remaining leading digits to add them later
    const phoneNumberLeadingDigits = targetNumber.slice(0, -7);

    // Get last 7 digits of the phone number
    const phoneNumberDigitsToConvert = targetNumber.slice(-7);

    // Check if a phone number only has 0s and 1s and no other digits
    if (checkIsBinary(phoneNumberDigitsToConvert)) {
      throw new Error("onlyBinary");
    }

    // Store words from JSON file if not already present
    const wordSet = await loadWordSet();

    // Store the generated vanity numbers in a set
    let generatedVanityNumbers = new Set<string>();

    // Generate all 7 alphabet combinations
    const combinations = generateAllFullLengthCombinations(
      phoneNumberDigitsToConvert
    );

    // Check if there are exact matches
    const exactMatches = findExactMatches(combinations, wordSet);
    exactMatches.map((match) => generatedVanityNumbers.add(match));

    // If not enough matches use the slidingMatches function to generate alphabets
    if (generatedVanityNumbers.size < 5) {
      findSlidingMatches(
        combinations,
        wordSet,
        phoneNumberDigitsToConvert.length - 1,
        generatedVanityNumbers,
        phoneNumberDigitsToConvert
      );
    }

    // If still not enough matches, generate randomly
    if (generatedVanityNumbers.size < 5) {
      fallbackRandomLetters(phoneNumberDigitsToConvert, generatedVanityNumbers);
    }

    // Sort vanity numbers in descending order of alphabets they contain, most alphabet-containing number first
    generatedVanityNumbers = sortedVanityNumbers([
      ...generatedVanityNumbers,
    ]) as unknown as Set<string>;

    // Convert set to Array and Prepending Leading Digits    
    const vanityNumbersArray = filterFiveResultsAndPrepend(generatedVanityNumbers, phoneNumberLeadingDigits);

    // Prepare message to send to SQS queue
    const messageToQueue = {
      phoneNumber: phoneNumber,
      targetNumber: targetNumber,
      timestamp,
      vanityNumbers: {
        first: vanityNumbersArray[0],
        second: vanityNumbersArray[1],
        third: vanityNumbersArray[2],
        fourth: vanityNumbersArray[3],
        fifth: vanityNumbersArray[4],
      },
    };

    // Send Message to SQS Queue
    await sendNumbersToQueue(messageToQueue);

    const response: Response = {
      ssmlResponse: `<speak>The first number is 
      <break time="0.3s"/>
      <say-as interpret-as="telephone">${vanityNumbersArray[0]}</say-as>.
      <break time="0.7s"/>
      The second number is 
      <say-as interpret-as="telephone">${vanityNumbersArray[1]}</say-as>.
      <break time="0.7s"/>
      And the third number is 
      <say-as interpret-as="telephone">${vanityNumbersArray[2]}</say-as>.</speak>`,
      ssmlError: "false",
    };

    return response;
  } catch (error: any) {
    console.log(error, error.message);

    const response: Response = {
      ssmlResponse: "",
      ssmlError: "true",
    };

    switch (error.message) {
      case "invalidNumber":
        response.ssmlResponse =
          "<speak>Sorry, the phone number you entered is invalid. Please provide a valid phone number.</speak>";
        break;

      case "onlyBinary":
        response.ssmlResponse =
          "<speak>The phone number is vanity incompatible because it only has 0s and 1s in its last 7 digits.</speak>";
        break;

      default:
        response.ssmlResponse =
          "<speak>An unknown error occurred. Please try later!</speak>";
        break;
    }
    return response;
  }
};
