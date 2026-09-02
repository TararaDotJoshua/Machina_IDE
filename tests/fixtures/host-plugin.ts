import { definePlugin } from '@mechatronics-ide/plugin-sdk';

export default definePlugin({
  activate(context) {
    context.ai.registerTool('test.records.list', async () => {
      const state = await context.project.getState<{ records?: unknown[] }>();
      return state?.records ?? [];
    });
  },
});
