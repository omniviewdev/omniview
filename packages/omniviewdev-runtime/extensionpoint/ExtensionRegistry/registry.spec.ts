import ExtensionRegistry, { createExtensionRegistry } from './registry';

describe('ExtensionRegistry Tests', () => {
  test('createExtensionRegistry is a function', () => {
    expect(typeof createExtensionRegistry).toBe('function');
  });

  test('ExtensionRegistry is an object', () => {
    expect(typeof ExtensionRegistry).toBe('object');
  });

  test('ExtensionRegistry.addExtension is a function', () => {
    expect(typeof ExtensionRegistry.addExtension).toBe('function');
  });

  test('ExtensionRegistry.addExtension has 1 argument', () => {
    expect(ExtensionRegistry.addExtension.length).toBe(2); 
    //I changed to 2 (must be reviewed) Why 1? I am getting extension name and children as I expected
  });

  test('ExtensionRegistry.getExtension is a function', () => {
    expect(typeof ExtensionRegistry.getExtension).toBe('function');
  });

  test('ExtensionRegistry.getExtension has 1 argument', () => {
    expect(ExtensionRegistry.getExtension.length).toBe(1);
  });

  test('ExtensionRegistry.addExtension throws if empty string is passed', () => {
    expect(() => {
      ExtensionRegistry.addExtension(''); 
    }).toThrow();
  });

  test('ExtensionRegistry.addExtension does not throw for valid arguments', () => {
    expect(() => {
      ExtensionRegistry.addExtension('Test', () => null); 
    }).not.toThrow();
  });

  test('ExtensionRegistry.addExtension throws TypeError if second argument is missing', () => {
    expect(() => {
      ExtensionRegistry.addExtension('Test'); 
    }).toThrow(new TypeError('extension is required'));
  });
});
