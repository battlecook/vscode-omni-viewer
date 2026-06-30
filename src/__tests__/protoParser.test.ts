import { parseProto } from '../utils/protoParser';

describe('parseProto', () => {
    it('indexes messages, enums, services, imports, and references', () => {
        const model = parseProto(`
syntax = "proto3";
package acme.orders;

import "google/protobuf/timestamp.proto";

// Order information.
message Order {
  string id = 1;
  repeated Line lines = 2;
  Status status = 3;

  message Line {
    string sku = 1;
    int32 quantity = 2;
  }
}

enum Status {
  STATUS_UNSPECIFIED = 0;
  STATUS_OPEN = 1;
}

service OrderService {
  // Fetch an order.
  rpc GetOrder (Order) returns (Order) {
    option deprecated = true;
  }
  rpc StreamOrders (Order) returns (stream Order);
}
`, 'order.proto');

        expect(model.syntax).toBe('proto3');
        expect(model.packageName).toBe('acme.orders');
        expect(model.imports).toEqual(['google/protobuf/timestamp.proto']);
        expect(model.stats).toMatchObject({
            messages: 2,
            enums: 1,
            services: 1,
            rpcs: 2,
            fields: 5,
            imports: 1
        });

        const order = model.messages[0];
        expect(order.fullName).toBe('acme.orders.Order');
        expect(order.documentation).toBe('Order information.');
        expect(order.messages[0].fullName).toBe('acme.orders.Order.Line');
        expect(model.enums[0].values[1]).toMatchObject({ name: 'STATUS_OPEN', number: 1 });
        expect(model.services[0].rpcs[0]).toMatchObject({
            name: 'GetOrder',
            requestType: 'Order',
            responseType: 'Order',
            documentation: 'Fetch an order.'
        });
        expect(model.services[0].rpcs[1]).toMatchObject({
            name: 'StreamOrders',
            requestType: 'Order',
            responseType: 'Order',
            responseStream: true
        });
        expect(model.references).toEqual(expect.arrayContaining([
            expect.objectContaining({ fromKind: 'import', to: 'google/protobuf/timestamp.proto' }),
            expect.objectContaining({ from: 'acme.orders.Order', name: 'lines', to: 'Line' }),
            expect.objectContaining({ from: 'acme.orders.OrderService.GetOrder', name: 'request', to: 'Order' })
        ]));
    });

    it('warns about duplicate field numbers', () => {
        const model = parseProto(`
syntax = "proto3";
message Broken {
  string first = 1;
  string second = 1;
}
`);

        expect(model.warnings).toContain('Broken reuses field number 1 for first and second.');
    });
});
