import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser, CurrentUserData } from './current-user.decorator';

type CustomDecoratorFactory = (
  data: keyof CurrentUserData | undefined,
  ctx: ExecutionContext,
) => unknown;

function getParamDecoratorFactory(): CustomDecoratorFactory {
  class TestClass {
    testMethod(@CurrentUser() _user: CurrentUserData) {
      return _user;
    }
  }
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    TestClass,
    'testMethod',
  ) as Record<string, { factory: CustomDecoratorFactory }>;
  const key = Object.keys(args)[0];
  return args[key].factory;
}

describe('CurrentUser decorator', () => {
  it('should extract user object from request', () => {
    const factory = getParamDecoratorFactory();
    const mockUser: CurrentUserData = { id: 'u1', email: 'test@email.com' };
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
