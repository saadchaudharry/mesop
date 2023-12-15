import ts from 'typescript';
// @ts-ignore
import fs from 'fs';
// @ts-ignore
import path from 'path';

import * as pb from './component_spec_jspb_proto_pb/component_specs/component_spec_pb';
import {assert, capitalize, parseArgs, upperCamelCase} from './util';

/**
 * Event properties.
 *
 * Content. OK (manual)
 */

// TO DO: not hard code
const TARGET_CLASS_NAME = 'MatCheckbox';

const SPEC = new pb.ComponentSpecInput();
SPEC.setName('checkbox');
SPEC.setFilePath(
  '/Users/will/Documents/GitHub/mesop/component_specs/input_data/checkbox.ts',
);
SPEC.setTargetClass('MatCheckbox');
SPEC.setHasContent(true);

interface Issue {
  msg: string;
  context: any;
  node: any;
}

class NgParser {
  proto: pb.ComponentSpec;
  private issues: Issue[] = [];
  private currentNode!: ts.Node;
  sourceFile!: ts.SourceFile;
  constructor(private readonly input: pb.ComponentSpecInput) {
    this.proto = new pb.ComponentSpec();
    this.proto.setInput(input);
    this.parseTs(this.input.getFilePath());
  }

  parseTs(filePath: string) {
    // Read the TypeScript file
    const fileContents = fs.readFileSync(filePath, 'utf8');

    // Parse the file contents into a TypeScript AST
    this.sourceFile = ts.createSourceFile(
      filePath,
      fileContents,
      ts.ScriptTarget.Latest,
      true, // setParentNodes flag
    );

    this.sourceFile.statements.find((s) => {
      if (ts.isClassDeclaration(s)) {
        if (s.name?.escapedText === this.input.getTargetClass()) {
          this.processClass(s);
        }
      }
    });
  }

  logIssue(msg: string, context?: object | string) {
    this.issues.push({msg, context, node: this.currentNode?.getText()});
  }

  validate(): boolean {
    const FgRed = '\x1b[31m';
    const FgGreen = '\x1b[32m';
    const Reset = '\x1b[0m';

    if (this.issues.length) {
      console.error(FgRed, '========================');
      console.error(FgRed, this.issues.length + ' issues found', Reset);
      for (const issue of this.issues) {
        console.error(issue.msg, issue.context, issue.node);
      }
      return false;
    } else {
      console.log(FgGreen, 'Validation succeeded!');
      return true;
    }
  }

  processClass(cls: ts.ClassDeclaration) {
    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member)) {
        continue;
      }
      const prop = member as ts.PropertyDeclaration;
      this.currentNode = prop;
      if (!prop.modifiers) {
        continue;
      }
      for (const modifier of prop.modifiers) {
        if (ts.isDecorator(modifier)) {
          const decorator = modifier as ts.Decorator;
          if (ts.isCallExpression(decorator.expression)) {
            const callExpression = decorator.expression;
            if (ts.isIdentifier(callExpression.expression)) {
              const identifier = callExpression.expression as ts.Identifier;
              if (identifier.escapedText === 'Input') {
                this.processInput(prop);
              } else if (identifier.escapedText === 'Output') {
                this.processOutput(prop);
              }
            }
          }
        }
      }
    }
  }

  processInput(prop: ts.PropertyDeclaration): void {
    this.currentNode = prop;
    const name = prop.name;
    if (ts.isIdentifier(name)) {
      const elName = name.escapedText.toString();
      const inputProp = new pb.Prop();
      inputProp.setName(elName);
      inputProp.setDebugType(prop.type!.getText());
      inputProp.setType(this.getType(assert(prop.type)));
      this.proto.addInputProps(inputProp);
    } else {
      throw new Error('Expected identifier for prop' + prop);
    }
  }

  processOutput(p: ts.PropertyDeclaration): void {
    const initializer = p.initializer!;
    if (ts.isNewExpression(initializer)) {
      const name = p.name.getText();
      const type = initializer.typeArguments![0].getText();

      const outputProp = new pb.OutputProp();
      outputProp.setName(name);
      // If the type is simple, then we compute based on the name
      // else, we use the type directly
      const simpleType = this.getSimpleType(type);
      if (simpleType) {
        outputProp.setEventName(this.formatEventName(name));
        const eventProp = new pb.Prop();
        eventProp.setName(name.replace('Change', ''));
        const type = new pb.XType();
        type.setSimpleType(simpleType);
        eventProp.setType(type);
        outputProp.addEventProps(eventProp);
      } else {
        outputProp.setEventName(this.formatEventName(type));
        outputProp.setEventPropsList(this.getEventProps(type));
      }
      this.proto.addOutputProps(outputProp);
    }
  }
  getEventProps(type: string): pb.Prop[] {
    for (const statement of this.sourceFile.statements) {
      if (ts.isClassDeclaration(statement)) {
        const cls = statement;
        if (cls.name?.getText() === type) {
          const eventProps: pb.Prop[] = [];
          // This is the right one;
          for (const member of cls.members) {
            if (ts.isPropertyDeclaration(member)) {
              const property = member;
              const simpleType = this.getSimpleType(property.type?.getText()!);
              if (simpleType) {
                const eventProp = new pb.Prop();
                eventProp.setName(property.name.getText());
                const typeProto = new pb.XType();
                typeProto.setSimpleType(simpleType);
                eventProp.setType(typeProto);
                eventProps.push(eventProp);
              } else {
                // Deliberately ignore since we can't transmit something like an element
                // reference through our protocol.
              }
            }
          }

          return eventProps;
        }
      }
    }
    this.logIssue("Didn't get event props", {event: type});
    return [];
  }

  formatEventName(name: string): string {
    let str = capitalize(name) + 'Event';
    if (name !== capitalize(name)) {
      str = upperCamelCase(this.input.getName()) + str;
    }
    if (str.startsWith('Mat')) {
      str = str.slice(3);
    }
    return str;
  }

  formatPropName(name: string): string {
    return capitalize(name);
  }

  getType(type: ts.TypeNode): pb.XType {
    const text = type.getText();
    const segments = text
      .split('|')
      .map((s) => s.trim())
      .filter((s) => ['null', 'undefined'].every((val) => val !== s));
    const simpleTypes = segments.map((s) => this.getSimpleType(s));
    if (simpleTypes.length === 1) {
      const typeProto = new pb.XType();
      if (simpleTypes[0]) {
        typeProto.setSimpleType(simpleTypes[0]);
      } else {
        this.logIssue('Unhandled simple type', {type: simpleTypes[0]});
      }
      return typeProto;
    } else {
      // We asumme these are string literals.
      const stringLiterals = segments.map((t) => {
        // Strip of quotes (but sanity check first)
        if (t[0] !== "'" && t[t.length - 1] !== "'") {
          this.logIssue('Unexpected type', {type: text});
          return '<issue>';
        }
        return t.slice(1, -1);
      });
      const typeProto = new pb.XType();
      const sl = new pb.StringLiterals();
      sl.setStringLiteralList(stringLiterals);
      typeProto.setStringLiterals(sl);
      return typeProto;
    }
  }

  getSimpleType(type: string): pb.SimpleTypeMap[keyof pb.SimpleTypeMap] | null {
    switch (type) {
      case 'string':
        return pb.SimpleType.STRING;
      case 'boolean':
        return pb.SimpleType.BOOL;
      case 'number':
        return pb.SimpleType.NUMBER;
      default:
        return null;
    }
  }
}

function main() {
  const args = parseArgs();
  if (!args['out']) {
    throw new Error('Must define --out flag (path to output data)');
  }

  const parser = new NgParser(SPEC);

  console.log(JSON.stringify(parser.proto.toObject(), null, 2));

  if (parser.validate()) {
    fs.writeFileSync(
      path.join(args['out'], `${parser.proto.getInput()!.getName()}.json`),
      JSON.stringify(parser.proto.toObject(), null, 2),
    );
  }
}

main();