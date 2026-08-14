import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';

function getParamDecoratorFactory(decorator: Function) {
  class TestClass {
    testMethod(@CurrentUser() _user: any) {}
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestClass, 'testMethod');
  return args[Object.keys(args)[0]].factory;
}

describe('CurrentUser decorator', () => {
  it('should extract user object from request', () => {
    const factory = getParamDecoratorFactory(CurrentUser);
    const mockUser = { id: 'u1', email: 'test@email.com' };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user: mockUser }),
      }),
    } as unknown as ExecutionContext;

    expect(factory(undefined, ctx)).toEqual(mockUser);
    expect(factory('id', ctx)).toBe('u1');
    expect(factory('email', ctx)).toBe('test@email.com');
  });
});
