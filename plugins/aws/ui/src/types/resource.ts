/**
 * Generic AWS resource object type.
 * Unlike Kubernetes, AWS resources don't share a common metadata structure.
 * Resources are returned as flat JSON objects from the AWS SDK.
 */
export interface AWSResourceObject {
  [key: string]: any;
}
